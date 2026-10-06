import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { PostgresRateLimitStore } from "../server/rate-limit-store.js";
import { createPaymentPlan } from "../server/services.js";
import { deliverNotifications } from "../server/jobs.js";

test("PostgreSQL counters remain atomic across stores and expired windows reset", async (t) => {
  const db = await openTestDatabase();
  t.after(() => db.close());
  const stores = [
    new PostgresRateLimitStore(db, "login"),
    new PostgresRateLimitStore(db, "login"),
  ];
  stores.forEach((store) => store.init({ windowMs: 900000 }));
  const hits = await Promise.all(
    Array.from({ length: 40 }, (_, i) => stores[i % 2].increment("account")),
  );
  assert.deepEqual(
    hits.map((hit) => hit.totalHits).sort((a, b) => a - b),
    Array.from({ length: 40 }, (_, i) => i + 1),
  );
  await db.query(
    "UPDATE auth_rate_limits SET reset_at=now()-interval '1 second'",
  );
  assert.equal((await stores[1].increment("account")).totalHits, 1);
});

test("concurrent installment creation cannot exceed the invoice balance", async (t) => {
  const db = await openTestDatabase();
  t.after(() => db.close());
  await db.exec(`INSERT INTO schools(id,name,short_code) VALUES(1,'Test','TEST');
    INSERT INTO roles(name,permissions) VALUES('SUPER_ADMIN','["*"]');
    INSERT INTO users(id,school_id,name,email,password_hash,role) VALUES(1,1,'Admin','admin@example.com','unused','SUPER_ADMIN');
    INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES(1,1,'Year','2026-01-01','2026-12-31');
    INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES(1,1,1,'Term','2026-01-01','2026-04-01');
    INSERT INTO students(id,school_id,first_name,last_name,gender,date_of_birth,guardian_name,guardian_phone) VALUES(1,1,'Test','Student','MALE','2010-01-01','Parent','123');
    INSERT INTO student_invoices(id,school_id,student_id,term_id,invoice_number,total_cents,due_date) VALUES(1,1,1,1,'INV-TEST',10000,'2026-12-01');`);
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      createPaymentPlan(db, { id: 1, school_id: 1 }, 1, {
        amount_cents: 6000,
        due_date: "2026-12-01",
        note: "",
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 422);
  assert.equal(
    Number(
      (await db.query("SELECT sum(amount_cents) AS total FROM payment_plans"))
        .rows[0].total,
    ),
    6000,
  );
});

test("PostgreSQL notification claims exclude other workers and recover expired leases", async (t) => {
  const db = await openTestDatabase();
  t.after(() => db.close());
  await db.exec(`INSERT INTO schools(id,name,short_code) VALUES(1,'Test','TEST');
    INSERT INTO notifications(school_id,email,title,body,dedupe_key,claim_token,claimed_until)
    VALUES(1,'parent@example.com','Reminder','Fees','test','crashed',now()-interval '1 second');`);
  let sends = 0;
  const options = {
    configuration: async () => ({}),
    send: async () => {
      sends++;
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
  await Promise.all([
    deliverNotifications(db, options),
    deliverNotifications(db, options),
  ]);
  assert.equal(sends, 1);
  assert.equal(
    (await db.query("SELECT delivery_status FROM notifications")).rows[0]
      .delivery_status,
    "SENT",
  );
});
