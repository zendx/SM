import { test as unitTest } from "node:test";
import { test, openTestDatabase } from "./database.js";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { sendEmail, emailErrorCode } from "../server/email-delivery.js";
import { runJobs } from "../server/jobs.js";
import { createApp } from "./app.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";

unitTest(
  "unrelated background failures do not prevent school or platform email tasks",
  async () => {
    const called = [],
      queries = [];
    const db = {
      query: async (sql, args) => {
        queries.push({ sql, args });
        return { rows: [] };
      },
    };
    const tasks = {};
    for (const name of [
      "cleanup",
      "document_cleanup",
      "verification_email",
      "account_closures",
      "automatic_renewals",
      "subscription_expiry",
      "onboarding_email",
      "mfa_reminders",
      "school_notices",
      "school_email",
      "platform_email",
    ])
      tasks[name] = async () => {
        called.push(name);
        if (name === "document_cleanup")
          throw Object.assign(new Error("Sensitive provider details"), {
            code: "STORAGE_UNAVAILABLE",
          });
      };
    await assert.rejects(
      runJobs(db, tasks),
      /document_cleanup: STORAGE_UNAVAILABLE/,
    );
    assert.ok(called.includes("school_email"));
    assert.ok(called.includes("platform_email"));
    assert.equal(
      queries.at(-1).args[0],
      "document_cleanup: STORAGE_UNAVAILABLE",
    );
    assert.ok(!JSON.stringify(queries).includes("Sensitive provider details"));
  },
);
unitTest(
  "SMTP rejection is a failure, transports close on every outcome and diagnostic text excludes provider details",
  async () => {
    const original = nodemailer.createTransport;
    let closed = 0;
    try {
      nodemailer.createTransport = () => ({
        sendMail: async () => ({
          accepted: [],
          rejected: ["private@example.test"],
        }),
        close: () => closed++,
      });
      await assert.rejects(
        sendEmail(
          { transport: "smtp://mail.test", from: "sender@test.invalid" },
          { to: "recipient@test.invalid" },
        ),
        { code: "RECIPIENT_REJECTED" },
      );
      nodemailer.createTransport = () => ({
        sendMail: async () => {
          throw Object.assign(new Error("secret credentials"), {
            code: "EAUTH",
            responseCode: 535,
            command: "AUTH PLAIN",
          });
        },
        close: () => closed++,
      });
      await assert.rejects(
        sendEmail({ transport: {} }, { to: "recipient@test.invalid" }),
        { code: "EAUTH" },
      );
      assert.equal(closed, 2);
      assert.equal(
        emailErrorCode({
          code: "EAUTH",
          responseCode: 535,
          command: "AUTH PLAIN",
          message: "secret credentials",
        }),
        "EAUTH / 535 / AUTH PLAIN",
      );
    } finally {
      nodemailer.createTransport = original;
    }
  },
);
test("email diagnostics and retry are owner-only and never requeue sent messages", async () => {
  const db = await openTestDatabase();
  let server;
  try {
    const app = await createApp(db);
    const password = "Email-diagnostics-2026!";
    const owner = await insert(db, "users", {
      school_id: null,
      name: "Owner",
      email: "owner@email.test",
      password_hash: hashPassword(password),
      role: "PLATFORM_OWNER",
    });
    await insert(db, "platform_operators", { user_id: owner.id });
    const school = await insert(db, "schools", {
      name: "Email School",
      short_code: "EMAIL",
    });
    const admin = await insert(db, "users", {
      school_id: school.id,
      name: "Administrator",
      email: "admin@email.test",
      password_hash: hashPassword(password),
      role: "SUPER_ADMIN",
    });
    const failed = await insert(db, "platform_notifications", {
      user_id: owner.id,
      school_id: null,
      email: owner.email,
      title: "Failed",
      body: "Test",
      link: "/owner#inbox",
      dedupe_key: "failed",
      email_status: "FAILED",
      attempts: 5,
      last_error: "EAUTH",
    });
    const sent = await insert(db, "platform_notifications", {
      user_id: owner.id,
      school_id: null,
      email: owner.email,
      title: "Sent",
      body: "Test",
      link: "/owner#inbox",
      dedupe_key: "sent",
      email_status: "SENT",
      sent_at: new Date(),
    });
    await db.query(
      "INSERT INTO background_worker_status(id,smtp_configured) VALUES(1,false)",
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    async function login(email) {
      const r = await fetch(base + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(r.status, 200);
      return {
        cookie: r.headers.get("set-cookie").split(";")[0],
        csrf: (await r.json()).data.csrf,
      };
    }
    const ownerSession = await login(owner.email),
      tenantSession = await login(admin.email);
    async function call(session, method = "GET") {
      const r = await fetch(
        base +
          "/saas/owner/email-delivery" +
          (method === "POST" ? "/retry" : ""),
        {
          method,
          headers: { cookie: session.cookie, "x-csrf-token": session.csrf },
        },
      );
      return { status: r.status, body: await r.json() };
    }
    assert.equal((await call(tenantSession)).status, 403);
    assert.equal((await call(tenantSession, "POST")).status, 403);
    const status = await call(ownerSession);
    assert.equal(status.status, 200);
    assert.equal(status.body.data.worker.smtp_configured, false);
    assert.equal(status.body.data.failures[0].last_error, "EAUTH");
    const retry = await call(ownerSession, "POST");
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(retry.body.data.count, 1);
    assert.equal(
      (
        await one(
          db,
          "SELECT email_status FROM platform_notifications WHERE id=$1",
          [failed.id],
        )
      ).email_status,
      "PENDING",
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT email_status FROM platform_notifications WHERE id=$1",
          [sent.id],
        )
      ).email_status,
      "SENT",
    );
    assert.ok(
      await one(
        db,
        "SELECT id FROM audit_logs WHERE action='FAILED_EMAILS_REQUEUED'",
      ),
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await db.close();
  }
});
