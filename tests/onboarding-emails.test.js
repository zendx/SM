import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { testMailbox } from "./mailbox.js";
import { createApp } from "../server/app.js";
import { one, rows, insert } from "../server/db.js";
import { initializeSchema } from "../server/schema.js";
import {
  queueOnboardingEmails,
  deliverOnboardingEmails,
} from "../server/onboarding-emails.js";
import { hashPassword } from "../server/security.js";

test("registration schedules welcome and tour; owners edit, preview and pause while delivery claims deduplicate and retry", async () => {
  const verify = testMailbox();
  process.env.STOPREG_API_TOKEN = "";
  const db = await openTestDatabase();
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`,
    password = "Onboarding-test-2026!";
  const call = async (path, session, body, method = body ? "POST" : "GET") => {
    const response = await fetch(base + path, {
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
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = async (email, owner = false) => {
    await verify(email, base);
    const response = await call(
      owner ? "/auth/owner/login" : "/auth/login",
      null,
      { email, password },
    );
    assert.equal(response.status, 200);
    return { cookie: response.cookie, csrf: response.body.data.csrf };
  };
  const api = "/saas/owner/onboarding-emails";
  try {
    await call("/auth/owner/setup", null, {
      name: "Owner",
      email: "owner@onboard.test",
      password,
    });
    const owner = await login("owner@onboard.test", true);
    const body = {
      school_name: "Welcome School",
      portal_slug: "welcome-school",
      name: "New Admin",
      email: "admin@onboard.test",
      phone_number: "+2348012345678",
      password,
      plan: "FREE",
      privacy_accepted: true,
      year_name: "2026/27",
      start_date: "2026-09-01",
      end_date: "2027-07-31",
    };
    assert.equal((await call("/saas/register", null, body)).status, 201);
    const user = await one(db, "SELECT * FROM users WHERE email=$1", [
      body.email,
    ]);
    assert.equal(user.email_verified, false);
    const initial = await rows(
      db,
      "SELECT q.*,s.delay_minutes,s.template_key FROM onboarding_email_queue q JOIN onboarding_email_steps s ON s.id=q.step_id ORDER BY s.delay_minutes",
    );
    assert.equal(initial.length, 2);
    for (const queued of initial)
      assert.equal(
        new Date(queued.scheduled_at) - new Date(user.created_at),
        queued.delay_minutes * 60000,
      );
    await Promise.all([
      queueOnboardingEmails(db, user),
      queueOnboardingEmails(db, user),
    ]);
    assert.equal(
      (await one(db, "SELECT count(*)::int AS n FROM onboarding_email_queue"))
        .n,
      2,
    );
    const sent = [];
    const options = {
      configuration: async () => ({}),
      send: async (_, message, recipient) => sent.push({ message, recipient }),
    };
    await Promise.all([
      deliverOnboardingEmails(db, options),
      deliverOnboardingEmails(db, options),
    ]);
    assert.equal(sent.length, 1);
    assert.match(sent[0].message.subject, /Welcome to SMPIS/);
    assert.match(sent[0].message.text, /two-factor authentication/);
    assert.match(sent[0].message.html, /cid:smpis-brand/);
    const tenant = await login(body.email);
    assert.equal((await call(api, tenant)).status, 403);
    assert.equal(
      (await call(api + "/steps", tenant, { name: "No" })).status,
      403,
    );
    const staff = await insert(db, "users", {
      school_id: null,
      name: "Staff",
      email: "staff@onboard.test",
      role: "PLATFORM_STAFF",
      password_hash: hashPassword(password),
    });
    await insert(db, "platform_staff", {
      user_id: staff.id,
      scope: "TECHNICAL",
      created_by: (
        await one(db, "SELECT user_id FROM platform_operators LIMIT 1")
      ).user_id,
    });
    assert.equal((await call(api, await login(staff.email, true))).status, 403);
    const listing = (await call(api, owner)).body.data;
    const tour = listing.steps.find(
      (s) => s.template_key === "onboarding_tour",
    );
    const edit = {
      name: tour.name,
      subject: tour.subject,
      body: tour.body,
      delay_minutes: 60,
      enabled: false,
    };
    assert.equal(
      (await call(api + `/steps/${tour.id}`, owner, edit, "PATCH")).status,
      200,
    );
    assert.equal(
      new Date(
        (
          await one(
            db,
            "SELECT scheduled_at FROM onboarding_email_queue WHERE step_id=$1",
            [tour.id],
          )
        ).scheduled_at,
      ) - new Date(user.created_at),
      3600000,
    );
    await db.query(
      "UPDATE onboarding_email_queue SET scheduled_at=now()-interval '1 minute' WHERE step_id=$1",
      [tour.id],
    );
    await deliverOnboardingEmails(db, options);
    assert.equal(sent.length, 1);
    const preview = await call(api + `/steps/${tour.id}/preview`, owner);
    assert.match(preview.body.data.html, /data:image\/png;base64/);
    assert.match(preview.body.data.html, /Overview/);
    assert.match(preview.body.data.html, /Finance/);
    assert.match(preview.body.data.html, /Notifications/);
    assert.equal(
      (
        await call(
          api + `/steps/${tour.id}`,
          owner,
          { ...edit, delay_minutes: 0, enabled: true },
          "PATCH",
        )
      ).status,
      200,
    );
    await deliverOnboardingEmails(db, {
      configuration: async () => ({}),
      send: async () => {
        throw new Error("SMTP unavailable");
      },
    });
    const failed = await one(
      db,
      "SELECT * FROM onboarding_email_queue WHERE step_id=$1",
      [tour.id],
    );
    assert.equal(failed.attempts, 1);
    assert.equal(failed.claim_token, null);
    await deliverOnboardingEmails(db, options);
    assert.equal(sent.length, 1);
    await db.query(
      "UPDATE onboarding_email_queue SET delivery_status='FAILED',attempts=5 WHERE id=$1",
      [failed.id],
    );
    assert.equal(
      (await call(api + `/queue/${failed.id}/retry`, owner, {})).status,
      200,
    );
    await deliverOnboardingEmails(db, options);
    assert.equal(sent.length, 2);
    assert.match(sent[1].message.text, /Overview/);
    assert.equal(
      (await call(api + `/queue/${failed.id}/retry`, owner, {})).status,
      422,
    );
    assert.equal(
      (
        await call(api + "/steps", owner, {
          name: "Tips",
          subject: "Tips for {{name}}",
          body: "Tips for {{school_name}}: {{link}}",
          delay_minutes: 120,
          enabled: true,
        })
      ).status,
      201,
    );
    assert.equal(
      (await one(db, "SELECT count(*)::int AS n FROM onboarding_email_queue"))
        .n,
      2,
    );
    assert.equal(
      (
        await call(api + "/steps", owner, {
          name: "Bad",
          subject: "Bad",
          body: "{{password}} {{link}}",
          delay_minutes: 5,
          enabled: true,
        })
      ).status,
      422,
    );
    await initializeSchema(db);
    assert.equal(
      (
        await one(
          db,
          "SELECT delay_minutes,enabled FROM onboarding_email_steps WHERE id=$1",
          [tour.id],
        )
      ).delay_minutes,
      0,
    );
    const later = await call("/saas/register", null, {
      ...body,
      school_name: "Second School",
      portal_slug: "second-school",
      email: "second@onboard.test",
    });
    assert.equal(later.status, 201);
    assert.equal(
      (await one(db, "SELECT count(*)::int AS n FROM onboarding_email_queue"))
        .n,
      5,
    );
    await db.query(
      "UPDATE school_subscriptions SET status='TERMINATED' WHERE school_id=$1",
      [later.body.data.school.id],
    );
    await deliverOnboardingEmails(db, options);
    assert.equal(
      (
        await one(
          db,
          "SELECT count(*)::int AS n FROM onboarding_email_queue WHERE delivery_status='CANCELLED'",
        )
      ).n,
      3,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
