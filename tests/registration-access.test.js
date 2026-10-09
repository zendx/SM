import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";
import { initializeSchema } from "../server/schema.js";

test("verified registration, optional MFA, 30-day trials and owner portal scope", async () => {
  const db = await openTestDatabase();
  const originalTransport = nodemailer.createTransport;
  const env = { ...process.env };
  const messages = [];
  process.env.APP_URL = "https://smpis.test";
  process.env.SMTP_URL = "smtp://mail.test";
  process.env.MAIL_FROM = "accounts@smpis.test";
  process.env.REQUIRE_MFA = "true";
  nodemailer.createTransport = () => ({
    sendMail: async (m) => messages.push(m),
  });
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const password = "Verification-test-2026!";
  async function call(path, body, session, portal) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(session
          ? { Cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
        ...(portal ? { "x-smpis-portal": portal } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    return {
      status: response.status,
      ...result,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const linkToken = () =>
    new URL(
      messages
        .at(-1)
        .text.match(/https:\/\/\S+/)[0]
        .replace(/\.$/, ""),
    ).searchParams.get("verify");
  try {
    assert.equal(
      (
        await call("/auth/owner/setup", {
          name: "Owner",
          email: "owner@test.com",
          password,
        })
      ).status,
      201,
    );
    assert.equal(
      (await call("/auth/owner/login", { email: "owner@test.com", password }))
        .status,
      403,
    );
    const ownerToken = linkToken();
    assert.equal(
      (await call("/auth/email-verification/confirm", { token: ownerToken }))
        .status,
      200,
    );
    assert.equal(
      (await call("/auth/email-verification/confirm", { token: ownerToken }))
        .status,
      422,
    );
    const login = await call("/auth/owner/login", {
      email: "owner@test.com",
      password,
    });
    const owner = { cookie: login.cookie, csrf: login.data.csrf };
    assert.equal(login.data.user.mfa_setup_required, false);
    assert.equal((await call("/saas/owner", null, owner)).status, 200);
    const values = {
      school_name: "School A",
      phone_number: "+2348012345678",
      privacy_accepted: true,
      portal_slug: "school-a",
      name: "Admin",
      email: "admin@test.com",
      password,
      plan: "FREE",
      year_name: "2026/2027",
      start_date: "2026-09-01",
      end_date: "2027-07-31",
    };
    const signup = await call("/saas/register", values);
    assert.equal(signup.status, 201, JSON.stringify(signup));
    assert.equal(
      (
        await call("/saas/register", {
          ...values,
          school_name: "School B",
          phone_number: "+2348012345678",
          privacy_accepted: true,
          portal_slug: "school-b",
          email: "second@test.com",
        })
      ).status,
      201,
    );
    await db.query(
      "UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email='second@test.com')",
    );
    assert.equal(
      (await call("/auth/email-verification/confirm", { token: linkToken() }))
        .status,
      422,
    );
    const school = await one(
      db,
      "SELECT * FROM schools WHERE portal_slug='school-a'",
    );
    const sub = await one(
      db,
      "SELECT * FROM school_subscriptions WHERE school_id=$1",
      [school.id],
    );
    assert.ok(
      Math.abs(
        (new Date(sub.trial_ends_at) - new Date(school.created_at)) / 86400000 -
          30,
      ) < 0.01,
    );
    assert.equal(
      (await call("/auth/login", { email: values.email, password })).status,
      403,
    );
    await call("/auth/email-verification/resend", { email: values.email });
    assert.equal(
      (await call("/auth/email-verification/confirm", { token: linkToken() }))
        .status,
      200,
    );
    const adminLogin = await call("/auth/login", {
      email: values.email,
      password,
    });
    const admin = { cookie: adminLogin.cookie, csrf: adminLogin.data.csrf };
    assert.equal((await call("/config", null, admin, "school-a")).status, 200);
    const scoped = await call("/me", null, owner, "school-a");
    assert.equal(scoped.data.user.school_id, school.id);
    assert.equal(scoped.data.user.role, "SUPER_ADMIN");
    assert.ok(scoped.data.user.permissions.includes("*"));
    assert.equal((await call("/config", null, owner, "school-a")).status, 200);
    const second = await call("/me", null, owner, "school-b");
    assert.notEqual(second.data.user.school_id, school.id);
    const created = await call(
      "/users",
      {
        name: "Owner-created teacher",
        email: "teacher@test.com",
        password,
        role: "TEACHER",
      },
      owner,
      "school-b",
    );
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.school_id, second.data.user.school_id);
    const entry = await one(
      db,
      "SELECT * FROM audit_logs WHERE entity_type='users' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
      [created.data.id],
    );
    assert.equal(entry.user_id, login.data.user.id);
    assert.equal(entry.school_id, second.data.user.school_id);
    assert.equal((await call("/me", null, owner)).data.user.school_id, null);
    assert.equal(
      (await call("/config", null, admin, "another-school")).status,
      403,
    );
    await initializeSchema(db);
    assert.equal(
      new Date(
        (
          await one(
            db,
            "SELECT trial_ends_at FROM school_subscriptions WHERE school_id=$1",
            [school.id],
          )
        ).trial_ends_at,
      ).getTime(),
      new Date(sub.trial_ends_at).getTime(),
    );
    await db.query("UPDATE saas_settings SET trial_days=14 WHERE id=1");
    await db.query(
      "UPDATE school_subscriptions SET trial_ends_at=$2::timestamptz+interval '14 days',period_end=$2::timestamptz+interval '14 days' WHERE school_id=$1",
      [school.id, school.created_at],
    );
    await initializeSchema(db);
    const extended = await one(
      db,
      "SELECT trial_ends_at FROM school_subscriptions WHERE school_id=$1",
      [school.id],
    );
    assert.equal(
      new Date(extended.trial_ends_at).getTime(),
      new Date(sub.trial_ends_at).getTime(),
    );
    await initializeSchema(db);
    assert.equal(
      new Date(
        (
          await one(
            db,
            "SELECT trial_ends_at FROM school_subscriptions WHERE school_id=$1",
            [school.id],
          )
        ).trial_ends_at,
      ).getTime(),
      new Date(extended.trial_ends_at).getTime(),
    );
  } finally {
    nodemailer.createTransport = originalTransport;
    for (const key of ["APP_URL", "SMTP_URL", "MAIL_FROM", "REQUIRE_MFA"]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
