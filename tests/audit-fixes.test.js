import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import nodemailer from "nodemailer";
import { authRoutes } from "../server/auth.js";
import { hashPassword } from "../server/security.js";
import { deliverNotifications } from "../server/jobs.js";

function authDatabase(user) {
  const counters = new Map();
  return {
    async query(sql, args) {
      if (sql.startsWith("INSERT INTO auth_rate_limits")) {
        const hits = (counters.get(args[0]) || 0) + 1;
        counters.set(args[0], hits);
        return { rows: [{ hits, reset_at: new Date(Date.now() + args[1]) }] };
      }
      if (sql.includes("FROM users")) return { rows: user ? [user] : [] };
      return { rows: [] };
    },
  };
}
async function start(t, db, production = false) {
  const app = express();
  app.use(express.json());
  app.use(authRoutes(db, { production }));
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function request(base, path, body) {
  return fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
test("production login sets Secure even without NODE_ENV=production", async (t) => {
  const base = await start(
    t,
    authDatabase({
      id: 1,
      school_id: 1,
      email: "admin@example.com",
      status: "ACTIVE",
      email_verified: true,
      role: "SUPER_ADMIN",
      permissions: ["*"],
      password_hash: hashPassword("correct-password"),
    }),
    true,
  );
  const res = await request(base, "/login", {
    email: "admin@example.com",
    password: "correct-password",
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie"), /; Secure/);
});
test("account counters are shared across independently constructed auth routers", async (t) => {
  const db = authDatabase();
  const first = await start(t, db),
    second = await start(t, db);
  for (let i = 0; i < 30; i++) {
    const res = await request(i % 2 ? first : second, "/login", {
      email: "unknown@example.com",
      password: "wrong",
    });
    assert.equal(res.status, 401);
    await res.text();
  }
  assert.equal(
    (
      await request(second, "/login", {
        email: "UNKNOWN@example.com",
        password: "wrong",
      })
    ).status,
    429,
  );
});
test("password reset hides account existence when SMTP is absent or fails", async (t) => {
  const old = {
    APP_URL: process.env.APP_URL,
    SMTP_URL: process.env.SMTP_URL,
    MAIL_FROM: process.env.MAIL_FROM,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(old))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  });
  process.env.APP_URL = "https://school.example.com";
  delete process.env.SMTP_URL;
  delete process.env.MAIL_FROM;
  const unknown = await start(t, authDatabase());
  const known = await start(
    t,
    authDatabase({ id: 1, school_id: 1, email: "known@example.com" }),
  );
  const expected = await request(unknown, "/password-reset/request", {
    email: "unknown@example.com",
  });
  assert.equal(expected.status, 200);
  const body = await expected.json();
  const absent = await request(known, "/password-reset/request", {
    email: "known@example.com",
  });
  assert.equal(absent.status, 200);
  assert.deepEqual(await absent.json(), body);
  process.env.SMTP_URL = "smtp://mail.example.com";
  process.env.MAIL_FROM = "school@example.com";
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => {
      throw new Error("SMTP failed");
    },
  }));
  t.mock.method(console, "error", () => {});
  const failed = await request(known, "/password-reset/request", {
    email: "known@example.com",
  });
  assert.equal(failed.status, 200);
  assert.deepEqual(await failed.json(), body);
});
test("overlapping notification workers send once and release failed claims", async () => {
  const record = {
    id: 1,
    school_id: 1,
    email: "parent@example.com",
    delivery_status: "PENDING",
    attempts: 0,
  };
  const db = {
    async query(sql, args) {
      if (sql.startsWith("SELECT"))
        return {
          rows: record.delivery_status === "PENDING" ? [{ ...record }] : [],
        };
      if (sql.includes("RETURNING")) {
        if (record.claim_token || record.delivery_status !== "PENDING")
          return { rows: [] };
        record.claim_token = args[1];
        return { rows: [{ ...record }] };
      }
      assert.equal(record.claim_token, args[1]);
      if (sql.includes("attempts=attempts+1")) record.attempts++;
      else record.delivery_status = "SENT";
      record.claim_token = null;
      return { rows: [] };
    },
  };
  let sends = 0;
  const options = {
    configuration: async () => ({}),
    send: async () => {
      sends++;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
  await Promise.all([
    deliverNotifications(db, options),
    deliverNotifications(db, options),
  ]);
  assert.equal(sends, 1);
  assert.equal(record.delivery_status, "SENT");
  record.delivery_status = "PENDING";
  await deliverNotifications(db, {
    ...options,
    send: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(record.attempts, 1);
  assert.equal(record.claim_token, null);
  await deliverNotifications(db, options);
  assert.equal(record.delivery_status, "SENT");
});
