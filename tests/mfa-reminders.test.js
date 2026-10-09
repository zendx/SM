import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { insert, rows } from "../server/db.js";
import { queueMfaReminders } from "../server/mfa-reminders.js";
import { deliverPlatformNotifications } from "../server/platform-notifications.js";

test("weekly MFA reminders deduplicate, exclude ineligible users and stop after activation", async () => {
  const db = await openTestDatabase();
  try {
    await db.query(
      "INSERT INTO roles(name,permissions) VALUES('SUPER_ADMIN','[]'),('PLATFORM_OWNER','[]') ON CONFLICT DO NOTHING",
    );
    const school = await insert(db, "schools", {
      name: "Security School",
      short_code: "SEC",
      portal_slug: "security-school",
    });
    const makeUser = async (email, extra = {}) =>
      insert(db, "users", {
        school_id: school.id,
        name: "Admin",
        email,
        role: "SUPER_ADMIN",
        password_hash: "test-only",
        email_verified: true,
        created_at: new Date(Date.now() - 8 * 86400000),
        ...extra,
      });
    const eligible = await makeUser("eligible@test.com");
    const owner = await makeUser("owner@test.com", {
      school_id: null,
      role: "PLATFORM_OWNER",
    });
    await makeUser("enabled@test.com", { mfa_enabled: true });
    await makeUser("unverified@test.com", { email_verified: false });
    await makeUser("inactive@test.com", { status: "SUSPENDED" });
    await makeUser("new@test.com", { created_at: new Date() });
    const getNotices = () =>
      rows(
        db,
        "SELECT * FROM platform_notifications WHERE template_key='mfa_reminder' ORDER BY user_id,id",
      );
    await Promise.all([queueMfaReminders(db), queueMfaReminders(db)]);
    let notices = await getNotices();
    assert.equal(notices.length, 2);
    assert.equal(
      notices.find((n) => n.user_id === eligible.id).link,
      "/security-school/?security=mfa#administration",
    );
    assert.equal(
      notices.find((n) => n.user_id === owner.id).link,
      "/owner#security",
    );
    await db.query(
      "UPDATE users SET created_at=created_at-interval '7 days' WHERE id=$1",
      [eligible.id],
    );
    await queueMfaReminders(db);
    assert.equal((await getNotices()).length, 3);
    await db.query("UPDATE users SET mfa_enabled=true WHERE id=$1", [
      eligible.id,
    ]);
    const sent = [];
    await deliverPlatformNotifications(db, {
      configuration: async () => ({}),
      send: async (_, n) => sent.push(n),
    });
    assert.deepEqual(
      sent.map((n) => n.user_id),
      [owner.id],
    );
    await queueMfaReminders(db);
    notices = await getNotices();
    assert.ok(
      notices.filter((n) => n.user_id === eligible.id).every((n) => n.read_at),
    );
    await db.query(
      "UPDATE school_subscriptions SET status='SUSPENDED',suspension_reason='TENANT_PAUSED' WHERE school_id=$1",
      [school.id],
    );
    await makeUser("paused@test.com");
    await queueMfaReminders(db);
    assert.equal((await getNotices()).length, 3);
  } finally {
    await db.close();
  }
});
