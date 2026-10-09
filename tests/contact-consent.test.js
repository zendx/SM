import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, openTestDatabase } from "./database.js";
import { testMailbox } from "./mailbox.js";
import { createApp } from "../server/app.js";
import { one, rows } from "../server/db.js";
import { deliverPlatformNotifications } from "../server/platform-notifications.js";
import {
  newsletterUnsubscribeLink,
  PRIVACY_POLICY_VERSION,
} from "../server/contact-consent.js";
import { renderEmail } from "../server/email-templates.js";
import { initializeSchema } from "../server/schema.js";

test("signup privacy acknowledgment and channel consent govern newsletters, withdrawal and service delivery", async () => {
  const verify = testMailbox();
  process.env.STOPREG_API_TOKEN = "";
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const db = await openTestDatabase();
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`,
    password = "Consent-test-2026!";
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
  const signup = (slug, extra = {}) => ({
    school_name: slug,
    portal_slug: slug,
    name: "Admin",
    email: `${slug}@consent.test`,
    phone_number: "+2348012345678",
    password,
    plan: "FREE",
    privacy_accepted: true,
    year_name: "2026/2027",
    start_date: "2026-09-01",
    end_date: "2027-07-31",
    ...extra,
  });
  try {
    await call("/auth/owner/setup", null, {
      name: "Owner",
      email: "owner@consent.test",
      password,
    });
    const owner = await login("owner@consent.test", true);
    for (const value of [undefined, false]) {
      const response = await call(
        "/saas/register",
        null,
        signup("privacy-missing", { privacy_accepted: value }),
      );
      assert.equal(response.status, 422);
      assert.equal(response.body.errors[0].code, "PRIVACY_ACCEPTANCE_REQUIRED");
      assert.equal(
        (await one(db, "SELECT count(*)::int AS n FROM schools")).n,
        0,
      );
    }
    const a = signup("email-yes", { marketing_email_consent: true });
    const b = signup("phone-yes", { marketing_phone_consent: true });
    const c = signup("no-promotions");
    for (const values of [a, b, c])
      assert.equal((await call("/saas/register", null, values)).status, 201);
    const admin = await one(db, "SELECT * FROM users WHERE email=$1", [
      a.email,
    ]);
    assert.equal(admin.marketing_email_consent, true);
    assert.equal(admin.marketing_phone_consent, false);
    assert.ok(admin.privacy_accepted_at);
    assert.equal(admin.privacy_policy_version, PRIVACY_POLICY_VERSION);
    const decline = await one(db, "SELECT * FROM users WHERE email=$1", [
      c.email,
    ]);
    assert.equal(decline.marketing_email_consent, false);
    assert.equal(decline.marketing_phone_consent, false);
    assert.equal(
      (
        await rows(
          db,
          "SELECT * FROM audit_logs WHERE action='SIGNUP_CONTACT_CONSENT'",
        )
      ).length,
      3,
    );
    const tenant = await login(a.email);
    await login(b.email);
    await login(c.email);
    assert.equal(
      (await call("/subscription/contact-preferences", tenant)).body.data
        .marketing_email_consent,
      true,
    );
    const newsletter = {
      title: "SMPIS news",
      body: "New features and offers",
      audience: "ALL",
      message_kind: "PROMOTIONAL",
    };
    const queued = await call("/saas/owner/notifications", owner, newsletter);
    assert.equal(queued.status, 201);
    assert.equal(queued.body.data.recipients, 1);
    const notices = await rows(
      db,
      "SELECT * FROM platform_notifications WHERE template_key='promotional_newsletter'",
    );
    assert.deepEqual(
      notices.map((n) => n.user_id),
      [admin.id],
    );
    assert.equal(
      (await call("/saas/owner/contacts?marketing=email", owner)).body.data
        .length,
      1,
    );
    assert.equal(
      (await call("/saas/owner/contacts?marketing=phone", owner)).body.data[0]
        .email,
      b.email,
    );
    const link = newsletterUnsubscribeLink(admin);
    const token = new URL(link).searchParams.get("unsubscribe");
    const message = await renderEmail(db, "promotional_newsletter", {
      title: "News",
      body: "Updates",
      link: "https://smpis.test",
      unsubscribe_link: link,
    });
    assert.match(message.html, /Unsubscribe from promotional emails/);
    assert.ok(message.text.includes(link));
    assert.equal(message.headers["List-Unsubscribe"], `<${link}>`);
    assert.equal(
      (
        await call("/communications/unsubscribe", null, {
          token: `${admin.id}.${"0".repeat(64)}`,
        })
      ).status,
      422,
    );
    assert.equal(
      (await call("/communications/unsubscribe", null, { token })).status,
      200,
    );
    assert.equal(
      (await call("/communications/unsubscribe", null, { token })).status,
      200,
    );
    assert.equal(
      (
        await one(db, "SELECT marketing_email_consent FROM users WHERE id=$1", [
          admin.id,
        ])
      ).marketing_email_consent,
      false,
    );
    const sent = [];
    const options = {
      configuration: async () => ({}),
      send: async (_, n) => sent.push(n),
    };
    await deliverPlatformNotifications(db, options);
    assert.equal(sent.length, 0);
    assert.equal(
      (await call("/saas/owner/notifications", owner, newsletter)).status,
      422,
    );
    const service = await call("/saas/owner/notifications", owner, {
      ...newsletter,
      message_kind: "SERVICE",
    });
    assert.equal(service.body.data.recipients, 3);
    await db.query("DELETE FROM sessions");
    await deliverPlatformNotifications(db, options);
    assert.equal(sent.length, 3);
    assert.ok(sent.every((n) => n.template_key === "notification"));
    const newTenant = await login(a.email);
    assert.equal(
      (
        await call(
          "/subscription/contact-preferences",
          newTenant,
          {
            marketing_email_consent: true,
            marketing_phone_consent: false,
            user_id: decline.id,
          },
          "PATCH",
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await call(
          "/subscription/contact-preferences",
          newTenant,
          { marketing_email_consent: true, marketing_phone_consent: true },
          "PATCH",
        )
      ).status,
      200,
    );
    await initializeSchema(db);
    assert.equal(
      (
        await one(db, "SELECT marketing_phone_consent FROM users WHERE id=$1", [
          admin.id,
        ])
      ).marketing_phone_consent,
      true,
    );
    assert.equal(
      (
        await one(db, "SELECT marketing_email_consent FROM users WHERE id=$1", [
          decline.id,
        ])
      ).marketing_email_consent,
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
