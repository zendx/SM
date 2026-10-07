import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { renderEmail } from "../server/email-templates.js";
import { deliverPlatformNotifications } from "../server/platform-notifications.js";
import { initializeSchema } from "../server/schema.js";

test("owner replies retain history, bulk reads stay private, and email templates govern delivery", async () => {
  const db = await openTestDatabase(),
    app = await createApp(db),
    password = "Support-templates-2026!";
  const ownerUser = await insert(db, "users", {
    school_id: null,
    name: "Owner",
    email: "owner@templates.test",
    role: "PLATFORM_OWNER",
    password_hash: hashPassword(password),
  });
  await insert(db, "platform_operators", { user_id: ownerUser.id });
  const schools = [];
  for (const code of ["ONE", "TWO"]) {
    const school = await insert(db, "schools", {
      name: code,
      short_code: code,
      portal_slug: code.toLowerCase(),
    });
    schools.push(
      await insert(db, "users", {
        school_id: school.id,
        name: code,
        email: `${code.toLowerCase()}@templates.test`,
        role: "SUPER_ADMIN",
        password_hash: hashPassword(password),
      }),
    );
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function call(path, session, body, method = body ? "POST" : "GET") {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      ...(await res.json()),
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(user, owner = false) {
    const r = await call(owner ? "/auth/owner/login" : "/auth/login", null, {
      email: user.email,
      password,
    });
    assert.equal(r.status, 200);
    return { ...r.data, cookie: r.cookie };
  }
  try {
    const owner = await login(ownerUser, true),
      a = await login(schools[0]),
      b = await login(schools[1]);
    const templates = (await call("/saas/owner/email-templates", owner)).data;
    assert.ok(templates.some((t) => t.key === "support_received"));
    const edited = {
      subject: "Helpdesk: {{title}}",
      body: "SMPIS team\n{{body}}\nView {{link}}",
    };
    assert.equal(
      (
        await call(
          "/saas/owner/email-templates/support_reply",
          a,
          edited,
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/saas/owner/email-templates/support_reply",
          owner,
          { ...edited, body: "No placeholders" },
          "PATCH",
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await call(
          "/saas/owner/email-templates/support_reply",
          owner,
          { ...edited, body: "{{body}} {{link}} {{password}}" },
          "PATCH",
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await call(
          "/saas/owner/email-templates/support_reply",
          owner,
          edited,
          "PATCH",
        )
      ).status,
      200,
    );
    const ticket = (
      await call("/subscription/support", a, {
        department: "TECHNICAL",
        subject: "Need assistance",
        description: "Please help us set up attendance.",
      })
    ).data;
    for (const resolution of [
      "First reply from owner",
      "Second reply from owner",
    ])
      assert.equal(
        (
          await call(
            `/saas/owner/issues/${ticket.id}`,
            owner,
            { status: "IN_PROGRESS", resolution },
            "PATCH",
          )
        ).status,
        200,
      );
    const history = (await call("/subscription/support", a)).data[0].replies;
    assert.deepEqual(
      history.map((r) => r.body),
      ["First reply from owner", "Second reply from owner"],
    );
    assert.equal((await call("/subscription/support", b)).data.length, 0);
    assert.equal(
      (
        await call(
          `/saas/owner/issues/${ticket.id}`,
          owner,
          { status: "RESOLVED", resolution: "" },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.deepEqual(
      (await call("/subscription/support", a)).data[0].replies.map(
        (r) => r.body,
      ),
      history.map((r) => r.body),
    );
    const unread = (await call("/subscription/notices", a)).data;
    assert.equal(unread.length, 2);
    const mail = [];
    const original = nodemailer.createTransport;
    nodemailer.createTransport = () => ({
      sendMail: async (message) => mail.push(message),
    });
    const previousUrl = process.env.APP_URL;
    process.env.APP_URL = "https://smpis.test";
    try {
      await db.query(
        "UPDATE sessions SET last_seen_at=now()-interval '3 minutes'",
      );
      await deliverPlatformNotifications(db, {
        configuration: async () => ({ transport: {}, from: "help@smpis.test" }),
      });
    } finally {
      nodemailer.createTransport = original;
      if (previousUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previousUrl;
    }
    assert.ok(
      mail.some(
        (m) =>
          m.to === schools[0].email &&
          m.subject.startsWith("Helpdesk:") &&
          m.text.includes("Second reply from owner"),
      ),
    );
    assert.equal(
      (await call("/subscription/notices/read-all", a, {})).data.count,
      2,
    );
    assert.equal(
      (await call("/subscription/notices/read-all", a, {})).data.count,
      0,
    );
    assert.ok(
      (await call("/subscription/notices", owner)).data.every(
        (n) => !n.read_at,
      ),
    );
    assert.equal(
      (await call("/subscription/notices/read-all", owner, {})).data.count,
      1,
    );
    await db.query(
      `INSERT INTO platform_notifications(user_id,school_id,email,title,body,link,dedupe_key)
      SELECT $1,$2,$3,'Older notice','Message','/','bulk-test:'||n FROM generate_series(1,105) n`,
      [schools[1].id, schools[1].school_id, schools[1].email],
    );
    assert.equal((await call("/subscription/notices", b)).data.length, 100);
    assert.equal(
      (await call("/subscription/notices/read-all", b, {})).data.count,
      105,
    );
    await initializeSchema(db);
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM saas_support_replies WHERE ticket_id=$1",
          [ticket.id],
        )
      ).n,
      2,
    );
    assert.equal(
      (
        await renderEmail(db, "support_reply", {
          title: "Hello\r\nBcc: bad",
          body: "Message",
          link: "https://smpis.test",
        })
      ).subject,
      "Helpdesk: Hello  Bcc: bad",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
