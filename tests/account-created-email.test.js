import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { one, insert } from "../server/db.js";
import { hashPassword, verifyPassword, digest } from "../server/security.js";

test("tenant role creation emails escaped initial credentials; delivery failures keep accounts and report status", async () => {
  const db = await openTestDatabase();
  const app = await createApp(db);
  const originalTransport = nodemailer.createTransport;
  const messages = [];
  let failure = false;
  process.env.APP_URL = "https://smpis.test";
  process.env.SMTP_URL = "smtp://mail.test";
  process.env.MAIL_FROM = "accounts@smpis.test";
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      if (failure) throw new Error("SMTP rejected message");
      messages.push(message);
      return { accepted: [message.to], rejected: [] };
    },
  });
  const school = await insert(db, "schools", {
    name: "Role School",
    short_code: "ROLE",
    portal_slug: "role-school",
  });
  const admin = await insert(db, "users", {
    school_id: school.id,
    name: "Admin",
    email: "admin@roles.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword("Admin-password-2026!"),
  });
  await insert(db, "sessions", {
    token_hash: digest("role-session"),
    user_id: admin.id,
    csrf: "role-csrf",
    mfa_verified: true,
    expires_at: new Date(Date.now() + 3600000),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const password = "New-<pass>&2026!";
  try {
    for (const role of ["TEACHER", "FINANCE_OFFICER", "PARENT"]) {
      const response = await fetch(base + "/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "smpis_session=role-session",
          "x-csrf-token": "role-csrf",
        },
        body: JSON.stringify({
          name: "New <User>",
          email: `${role.toLowerCase()}@roles.test`,
          role,
          password,
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 201, JSON.stringify(body));
      assert.equal(body.data.account_email_sent, !failure);
      assert.ok(!JSON.stringify(body).includes(password));
      const stored = await one(db, "SELECT * FROM users WHERE id=$1", [
        body.data.id,
      ]);
      assert.ok(verifyPassword(password, stored.password_hash));
      if (!failure) {
        const message = messages.at(-1);
        assert.equal(message.to, stored.email);
        assert.ok(message.text.includes(password));
        assert.ok(message.text.includes(role.replaceAll("_", " ")));
        assert.ok(message.html.includes("New &lt;User&gt;"));
        assert.ok(message.html.includes("New-&lt;pass&gt;&amp;2026!"));
        assert.ok(message.html.includes("https://smpis.test/role-school/"));
        assert.ok(message.html.includes("cid:smpis-brand"));
        assert.ok(message.text.includes("Forgot your password?"));
        assert.ok(message.text.includes("Set up authenticator"));
      } else assert.ok(body.data.message.includes("could not be sent"));
      failure = role === "FINANCE_OFFICER";
    }
    const audits = await db.query("SELECT * FROM audit_logs");
    assert.ok(!JSON.stringify(audits.rows).includes(password));
  } finally {
    nodemailer.createTransport = originalTransport;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
