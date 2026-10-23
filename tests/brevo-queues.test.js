import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { insert, one } from "../server/db.js";
import { deliverNotifications } from "../server/jobs.js";
import {
  deliverPlatformNotifications,
  queueNotice,
} from "../server/platform-notifications.js";
import {
  queueVerification,
  deliverVerifications,
} from "../server/verification-delivery.js";
import {
  queueOnboardingEmails,
  deliverOnboardingEmails,
} from "../server/onboarding-emails.js";

test("all worker email queues use Brevo HTTPS and preserve failure retries", async () => {
  const db = await openTestDatabase(),
    originalFetch = globalThis.fetch;
  const names = ["EMAIL_PROVIDER", "BREVO_API_KEY", "MAIL_FROM", "APP_URL"];
  const old = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    Object.assign(process.env, {
      EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "fixture-api-key",
      MAIL_FROM: "SMPIS <do-not-reply@smpis.digital>",
      APP_URL: "https://smpis.test",
    });
    await createApp(db);
    const requests = [];
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 201,
        json: async () => ({ messageId: `<fixture-${requests.length}>` }),
      };
    };
    const school = await insert(db, "schools", {
      name: "Brevo School",
      short_code: "BREVO",
    });
    const user = await insert(db, "users", {
      school_id: school.id,
      name: "Administrator",
      email: "admin@brevo.test",
      password_hash: "unused",
      role: "SUPER_ADMIN",
      email_verified: false,
    });
    await queueVerification(db, user);
    await deliverVerifications(db, user.id);
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT count(*) AS count FROM verification_outbox WHERE user_id=$1",
            [user.id],
          )
        ).count,
      ),
      0,
    );
    await db.query("UPDATE users SET email_verified=true WHERE id=$1", [
      user.id,
    ]);
    await queueOnboardingEmails(db, user);
    await deliverOnboardingEmails(db);
    await insert(db, "notifications", {
      school_id: school.id,
      user_id: user.id,
      email: user.email,
      title: "School alert",
      body: "School alert",
      dedupe_key: "brevo-school",
    });
    await deliverNotifications(db);
    await queueNotice(db, user, {
      title: "Owner notice",
      body: "Owner notice",
      link: "/school-brevo/#notifications",
      key: "brevo-platform",
    });
    await deliverPlatformNotifications(db);
    assert.equal(requests.length, 4);
    assert.ok(
      requests.every(
        (r) =>
          r.htmlContent.includes("https://smpis.test/email-logo.png") &&
          !r.htmlContent.includes("cid:"),
      ),
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT email_status FROM platform_notifications WHERE dedupe_key='brevo-platform'",
        )
      ).email_status,
      "SENT",
    );
    assert.equal(
      (
        await one(
          db,
          "SELECT delivery_status FROM notifications WHERE dedupe_key='brevo-school'",
        )
      ).delivery_status,
      "SENT",
    );
    await queueNotice(db, user, {
      title: "Failure notice",
      body: "Failure notice",
      link: "/school-brevo/",
      key: "brevo-error",
    });
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await deliverPlatformNotifications(db);
    const failed = await one(
      db,
      "SELECT * FROM platform_notifications WHERE dedupe_key='brevo-error'",
    );
    assert.equal(failed.email_status, "PENDING");
    assert.equal(failed.attempts, 1);
    assert.match(failed.last_error, /BREVO_HTTP_401/);
    assert.ok(!failed.last_error.includes("fixture-api-key"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
    await db.close();
  }
});
