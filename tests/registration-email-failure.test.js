import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";

test("SMTP failure returns a safe signup error, rolls back records and permits retry", async () => {
  const db = await openTestDatabase();
  const keys = ["APP_URL", "SMTP_URL", "MAIL_FROM", "STOPREG_API_TOKEN"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalTransport = nodemailer.createTransport;
  const originalLog = console.error;
  const logs = [];
  let rejectMail = false;
  Object.assign(process.env, {
    APP_URL: "https://smpis.test",
    SMTP_URL: "smtp://mail.test",
    MAIL_FROM: "accounts@smpis.test",
    STOPREG_API_TOKEN: "",
  });
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      if (rejectMail)
        throw Object.assign(new Error("private SMTP credentials"), {
          code: "EAUTH",
          responseCode: 525,
          response:
            "525 5.7.1 Unauthorized IP address: private provider detail",
        });
    },
  });
  console.error = (...args) => logs.push(args);
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const post = async (path, body) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const counts = async () => {
    const result = {};
    for (const table of [
      "schools",
      "users",
      "academic_years",
      "terms",
      "school_subscriptions",
      "subscription_events",
      "email_verification_tokens",
      "onboarding_email_queue",
    ])
      result[table] = (
        await one(db, `SELECT count(*)::int AS n FROM ${table}`)
      ).n;
    return result;
  };
  try {
    const password = "Registration-test-2026!";
    assert.equal(
      (
        await post("/auth/owner/setup", {
          name: "Owner",
          email: "owner@test.com",
          password,
        })
      ).status,
      201,
    );
    const before = await counts();
    const signup = {
      school_name: "Email Retry School",
      portal_slug: "email-retry-school",
      name: "Admin",
      email: "admin@test.com",
      phone_number: "+2348012345678",
      privacy_accepted: true,
      password,
      plan: "FREE",
      year_name: "2026/2027",
      start_date: "2026-09-01",
      end_date: "2027-07-31",
    };
    rejectMail = true;
    const failed = await post("/saas/register", signup);
    assert.equal(failed.status, 503);
    assert.equal(failed.body.errors[0].code, "EMAIL_VERIFICATION_UNAVAILABLE");
    assert.match(
      failed.body.errors[0].message,
      /couldn't send your verification email/,
    );
    assert.doesNotMatch(JSON.stringify(failed.body), /private|EAUTH|525/);
    assert.deepEqual(await counts(), before);
    assert.deepEqual(logs, [
      [
        "Verification email delivery failed",
        {
          code: "EAUTH",
          responseCode: 525,
          unauthorizedIP: true,
        },
      ],
    ]);
    rejectMail = false;
    assert.equal((await post("/saas/register", signup)).status, 201);
    assert.equal((await counts()).schools, before.schools + 1);
  } finally {
    nodemailer.createTransport = originalTransport;
    console.error = originalLog;
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
