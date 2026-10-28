import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { insert, one } from "../server/db.js";
import {
  deliverSetupReminders,
  schoolSetupProgress,
} from "../server/setup-reminders.js";

async function fixture(db, slug, extra = {}) {
  await db.query(
    "INSERT INTO roles(name,permissions) VALUES('SUPER_ADMIN','[]') ON CONFLICT DO NOTHING",
  );
  const school = await insert(db, "schools", {
    name: `School ${slug}`,
    short_code: slug,
    portal_slug: slug,
    ...extra,
  });
  const user = await insert(db, "users", {
    school_id: school.id,
    name: "School Admin",
    email: `${slug}@test.invalid`,
    role: "SUPER_ADMIN",
    password_hash: "test-only",
    email_verified: true,
  });
  return { school, user };
}
const state = (db, school) =>
  one(db, "SELECT * FROM tenant_setup_reminders WHERE school_id=$1", [
    school.id,
  ]);
const due = (db, school) =>
  db.query(
    "UPDATE tenant_setup_reminders SET next_send_at=now()-interval '1 minute' WHERE school_id=$1",
    [school.id],
  );
const delivery = (messages) => ({
  configuration: async () => ({}),
  send: async (_, message, user) => messages.push({ ...message, user }),
});

test("new and existing tenants get ten distinct reminders, two days apart, without catch-up bursts", async () => {
  const db = await openTestDatabase();
  try {
    const fresh = await fixture(db, "fresh");
    const old = await fixture(db, "existing", {
      created_at: new Date("2024-01-01"),
    });
    const sent = [],
      options = delivery(sent);
    await deliverSetupReminders(db, options);
    assert.equal(sent.length, 0);
    for (const { school } of [fresh, old]) {
      const campaign = await state(db, school);
      assert.equal(campaign.sent_count, 0);
      assert.equal(+campaign.next_send_at - +campaign.started_at, 2 * 86400000);
    }
    for (let number = 1; number <= 10; number++) {
      for (const { school } of [fresh, old]) await due(db, school);
      await Promise.all([
        deliverSetupReminders(db, options),
        deliverSetupReminders(db, options),
      ]);
      assert.equal(sent.length, number * 2);
      for (const { school } of [fresh, old]) {
        const campaign = await state(db, school);
        assert.equal(campaign.sent_count, number);
        assert.equal(
          +campaign.next_send_at - +campaign.last_sent_at,
          2 * 86400000,
        );
      }
      await deliverSetupReminders(db, options);
      assert.equal(sent.length, number * 2);
    }
    for (const { school, user } of [fresh, old]) {
      const messages = sent.filter((message) => message.user.id === user.id);
      assert.equal(new Set(messages.map((m) => m.subject)).size, 10);
      assert.equal(new Set(messages.map((m) => m.text)).size, 10);
      assert.match(messages[0].text, /1 of 7 setup steps complete/);
      assert.match(
        messages[0].text,
        /Next: step 2 of 7 — Set the academic calendar/,
      );
      assert.match(
        messages[0].text,
        new RegExp(`/${school.portal_slug}/#administration/calendar`),
      );
      assert.match(
        messages[9].text,
        /last email in this setup reminder series/,
      );
      await due(db, school);
    }
    await deliverSetupReminders(db, options);
    assert.equal(sent.length, 20);
  } finally {
    await db.close();
  }
});

test("reminders read current seven-step progress and stop permanently on completion", async () => {
  const db = await openTestDatabase();
  const originalKeys = process.env.PAYSTACK_SCHOOL_KEYS_JSON;
  try {
    const { school } = await fixture(db, "progress");
    const sent = [],
      options = delivery(sent);
    await deliverSetupReminders(db, options);
    const year = await insert(db, "academic_years", {
      school_id: school.id,
      name: "2026",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
    const term = await insert(db, "terms", {
      school_id: school.id,
      academic_year_id: year.id,
      name: "Term 1",
      start_date: "2026-01-01",
      end_date: "2026-04-30",
      is_current: true,
    });
    await insert(db, "staff", {
      school_id: school.id,
      staff_number: "S1",
      first_name: "First",
      last_name: "Teacher",
      department: "Teaching",
      position: "Teacher",
      hire_date: "2026-01-01",
    });
    const classroom = await insert(db, "classes", {
      school_id: school.id,
      academic_year_id: year.id,
      name: "Class 1",
      capacity: 30,
    });
    await due(db, school);
    await deliverSetupReminders(db, options);
    assert.match(sent[0].text, /4 of 7 setup steps complete/);
    assert.match(sent[0].text, /Next: step 5 of 7 — Setup Payment Method/);
    assert.match(sent[0].text, /#administration\/integrations/);
    process.env.PAYSTACK_SCHOOL_KEYS_JSON = JSON.stringify({
      [school.id]: "sk_test_fixture",
    });
    await due(db, school);
    await deliverSetupReminders(db, options);
    assert.match(sent[1].text, /Next: step 6 of 7 — Set Fee Structure/);
    assert.match(sent[1].text, /#finance\/fee%20structures/);
    await insert(db, "fee_structures", {
      school_id: school.id,
      class_id: classroom.id,
      term_id: term.id,
      fee_category: "TUITION",
      amount_cents: 10000,
    });
    await due(db, school);
    await deliverSetupReminders(db, options);
    assert.match(sent[2].text, /Next: step 7 of 7 — Enroll your first student/);
    await insert(db, "students", {
      school_id: school.id,
      first_name: "First",
      last_name: "Student",
      gender: "OTHER",
      date_of_birth: "2020-01-01",
      guardian_name: "Parent",
      guardian_phone: "12345678",
      class_id: classroom.id,
      status: "ENROLLED",
    });
    assert.equal((await schoolSetupProgress(db, school.id)).complete, 7);
    await due(db, school);
    await deliverSetupReminders(db, options);
    assert.equal(sent.length, 3);
    assert.ok((await state(db, school)).completed_at);
    await db.query("UPDATE terms SET is_current=false WHERE id=$1", [term.id]);
    await deliverSetupReminders(db, options);
    assert.equal(
      sent.length,
      3,
      "completed initial setup must not restart after term changes",
    );
  } finally {
    if (originalKeys === undefined)
      delete process.env.PAYSTACK_SCHOOL_KEYS_JSON;
    else process.env.PAYSTACK_SCHOOL_KEYS_JSON = originalKeys;
    await db.close();
  }
});

test("paused, closed, unverified and inactive tenants are skipped; only one administrator receives each reminder", async () => {
  const db = await openTestDatabase();
  try {
    const sent = [],
      options = delivery(sent);
    const eligible = await fixture(db, "eligible");
    const unverified = await fixture(db, "unverified");
    const inactive = await fixture(db, "inactive");
    const paused = await fixture(db, "paused");
    const closed = await fixture(db, "closed");
    const deleted = await fixture(db, "deleted");
    const operator = await fixture(db, "operator");
    await insert(db, "platform_operators", { user_id: operator.user.id });
    await insert(db, "users", {
      school_id: eligible.school.id,
      name: "Second admin",
      email: "second@test.invalid",
      role: "SUPER_ADMIN",
      password_hash: "test",
      email_verified: true,
    });
    await deliverSetupReminders(db, options);
    await db.query("UPDATE users SET email_verified=false WHERE id=$1", [
      unverified.user.id,
    ]);
    await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
      inactive.user.id,
    ]);
    await db.query(
      "UPDATE school_subscriptions SET status='SUSPENDED',suspension_reason='TENANT_PAUSED' WHERE school_id=$1",
      [paused.school.id],
    );
    await db.query(
      "UPDATE school_subscriptions SET closed_at=now() WHERE school_id=$1",
      [closed.school.id],
    );
    await db.query(
      "UPDATE school_subscriptions SET deletion_requested_at=now() WHERE school_id=$1",
      [deleted.school.id],
    );
    for (const { school } of [
      eligible,
      unverified,
      inactive,
      paused,
      closed,
      deleted,
      operator,
    ])
      await due(db, school);
    await deliverSetupReminders(db, options);
    assert.deepEqual(
      sent.map((m) => m.user.id),
      [eligible.user.id],
    );
    assert.equal(await state(db, operator.school), undefined);
  } finally {
    await db.close();
  }
});

test("missing SMTP and failures do not advance the series; errors retry without duplicate successful sends", async () => {
  const db = await openTestDatabase();
  try {
    const { school } = await fixture(db, "retry");
    const sent = [],
      options = delivery(sent);
    await deliverSetupReminders(db, { configuration: async () => null });
    await due(db, school);
    await deliverSetupReminders(db, { configuration: async () => null });
    assert.equal((await state(db, school)).sent_count, 0);
    await deliverSetupReminders(db, {
      ...options,
      send: async () => {
        throw Object.assign(new Error("private credentials"), {
          code: "EAUTH",
        });
      },
    });
    let campaign = await state(db, school);
    assert.equal(campaign.sent_count, 0);
    assert.equal(campaign.attempts, 1);
    assert.equal(campaign.last_error, "EAUTH");
    assert.equal(campaign.claim_token, null);
    await deliverSetupReminders(db, options);
    assert.equal(sent.length, 0);
    await due(db, school);
    await deliverSetupReminders(db, options);
    campaign = await state(db, school);
    assert.equal(campaign.sent_count, 1);
    assert.equal(campaign.attempts, 0);
    assert.equal(campaign.last_error, "");
    assert.equal(sent.length, 1);
  } finally {
    await db.close();
  }
});
