import assert from "node:assert/strict";
import { test } from "./database.js";
import { accountFixture } from "./account-fixture.js";
import { insert, one, rows } from "../server/db.js";
import { digest } from "../server/security.js";
import { generateInvoice } from "../server/services.js";
import {
  initializeSchema,
  checkFeeEligibilitySchema,
} from "../server/schema.js";

test("fee eligibility preserves school membership across terms and promotions and never rebills admission", async () => {
  const f = await accountFixture();
  try {
    const db = f.db,
      u = f.users.tenant;
    const year = await insert(db, "academic_years", {
      school_id: f.school.id,
      name: "Fees year",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
    const terms = [];
    for (const [name, start, end] of [
      ["First", "2026-01-01", "2026-04-30"],
      ["Second", "2026-05-01", "2026-08-31"],
      ["Third", "2026-09-01", "2026-12-31"],
    ])
      terms.push(
        await insert(db, "terms", {
          school_id: f.school.id,
          academic_year_id: year.id,
          name,
          start_date: start,
          end_date: end,
        }),
      );
    const classes = [];
    for (const name of ["Basic 4", "Basic 5"])
      classes.push(
        await insert(db, "classes", {
          school_id: f.school.id,
          academic_year_id: year.id,
          name,
          capacity: 30,
        }),
      );
    for (const cls of classes)
      for (const term of terms)
        for (const [fee_category, amount_cents, applies_to] of [
          ["TUITION", 10000, "ALL"],
          ["ADMISSION", 5000, "NEW_INTAKES"],
          ["UNIFORM", 3000, "NEW_INTAKES"],
          ["ACTIVITY", 1000, "RETURNING"],
          ["BOARDING", 8000, "ALL"],
          ["TRANSPORT", 2000, "ALL"],
        ])
          await insert(db, "fee_structures", {
            school_id: f.school.id,
            class_id: cls.id,
            term_id: term.id,
            fee_category,
            amount_cents,
            applies_to,
          });
    async function student(name, status = "PROSPECTIVE", extra = {}) {
      const s = await insert(db, "students", {
        school_id: f.school.id,
        first_name: name,
        last_name: "Learner",
        gender: "OTHER",
        date_of_birth: "2015-01-01",
        guardian_name: "Guardian",
        guardian_phone: "08012345678",
        status,
        class_id: classes[0].id,
        ...extra,
      });
      if (status === "PROSPECTIVE")
        await insert(db, "admission_applications", {
          school_id: f.school.id,
          student_id: s.id,
          applied_class_id: classes[0].id,
          stage: "FEES_PENDING",
        });
      return s;
    }
    const bill = (s, t, actor = u) =>
      generateInvoice(db, actor, {
        student_id: s.id,
        term_id: t.id,
        due_date: t.end_date,
      });
    const descriptions = async (i) =>
      (
        await rows(
          db,
          "SELECT description FROM invoice_items WHERE invoice_id=$1 ORDER BY description",
          [i.id],
        )
      ).map((x) => x.description);
    const intake = await student("New intake");
    const first = await bill(intake, terms[0]);
    assert.equal(Number(first.total_cents), 18000);
    assert.deepEqual(await descriptions(first), [
      "ADMISSION",
      "TUITION",
      "UNIFORM",
    ]);
    assert.equal(
      (await bill(intake, terms[0])).id,
      first.id,
      "same-term generation is idempotent",
    );
    assert.equal(
      (
        await one(db, "SELECT school_entry_term_id FROM students WHERE id=$1", [
          intake.id,
        ])
      ).school_entry_term_id,
      terms[0].id,
    );
    await db.query("UPDATE students SET status='ENROLLED' WHERE id=$1", [
      intake.id,
    ]);
    const second = await bill(intake, terms[1]);
    assert.deepEqual(await descriptions(second), ["ACTIVITY", "TUITION"]);
    await db.query("UPDATE students SET class_id=$1 WHERE id=$2", [
      classes[1].id,
      intake.id,
    ]);
    const promoted = await bill(intake, terms[2]);
    assert.deepEqual(
      await descriptions(promoted),
      ["ACTIVITY", "TUITION"],
      "promotion never charges admission or new-intake uniform",
    );
    const nextYear = await insert(db, "academic_years", {
      school_id: f.school.id,
      name: "Following fees year",
      start_date: "2027-01-01",
      end_date: "2027-12-31",
    });
    const nextTerm = await insert(db, "terms", {
      school_id: f.school.id,
      academic_year_id: nextYear.id,
      name: "Following first term",
      start_date: "2027-01-01",
      end_date: "2027-04-30",
    });
    const nextClass = await insert(db, "classes", {
      school_id: f.school.id,
      academic_year_id: nextYear.id,
      name: "Basic 6",
      capacity: 30,
    });
    for (const [fee_category, applies_to] of [
      ["ADMISSION", "NEW_INTAKES"],
      ["TUITION", "ALL"],
    ])
      await insert(db, "fee_structures", {
        school_id: f.school.id,
        class_id: nextClass.id,
        term_id: nextTerm.id,
        fee_category,
        applies_to,
        amount_cents: 10000,
      });
    await db.query("UPDATE students SET class_id=$1 WHERE id=$2", [
      nextClass.id,
      intake.id,
    ]);
    assert.deepEqual(
      await descriptions(await bill(intake, nextTerm)),
      ["TUITION"],
      "promotion into a new academic year preserves school membership",
    );
    const legacy = await student("Existing member", "ENROLLED");
    assert.deepEqual(
      await descriptions(await bill(legacy, terms[0])),
      ["ACTIVITY", "TUITION"],
      "existing members without migrated billing metadata stay returning",
    );
    const history = await student("Enrollment history");
    await insert(db, "student_enrollment", {
      school_id: f.school.id,
      student_id: history.id,
      class_id: classes[0].id,
      enrollment_date: "2025-12-01",
    });
    assert.deepEqual(await descriptions(await bill(history, terms[0])), [
      "ACTIVITY",
      "TUITION",
    ]);
    const numbered = await student("Existing number", "PROSPECTIVE", {
      student_number: "EXISTING-123",
    });
    assert.deepEqual(await descriptions(await bill(numbered, terms[0])), [
      "ACTIVITY",
      "TUITION",
    ]);
    const boarding = await student("Boarding intake", "PROSPECTIVE", {
      boarding_status: "BOARDING",
      transportation_required: true,
    });
    assert.equal(
      Number((await bill(boarding, terms[0])).total_cents),
      28000,
      "boarding and transport eligibility still apply",
    );
    const concurrent = await student("Concurrent intake");
    const pair = await Promise.all([
      bill(concurrent, terms[0]),
      bill(concurrent, terms[1]),
    ]);
    assert.equal(
      (await Promise.all(pair.map(descriptions)))
        .flat()
        .filter((x) => x === "ADMISSION").length,
      1,
    );
    const oldItems = await descriptions(first);
    await db.query(
      "DELETE FROM fee_structures WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
      [f.school.id, classes[0].id, terms[0].id],
    );
    assert.deepEqual(
      await descriptions(await bill(intake, terms[0])),
      oldItems,
      "fee edits preserve existing invoices",
    );
    await assert.rejects(
      () => bill(legacy, terms[2], { ...u, school_id: f.otherSchool.id }),
      /Student not found/,
    );
    await initializeSchema(db);
    await initializeSchema(db);
    assert.equal(
      (
        await one(db, "SELECT school_entry_term_id FROM students WHERE id=$1", [
          intake.id,
        ])
      ).school_entry_term_id,
      terms[0].id,
      "repeat migrations preserve entry term",
    );
  } finally {
    await f.db.close();
  }
});

test("tenant fee setup validates audiences, removes unchecked fees atomically and batch billing uses eligibility", async () => {
  const f = await accountFixture();
  let server;
  try {
    const db = f.db;
    await insert(db, "sessions", {
      token_hash: digest("fee-test-session"),
      user_id: f.users.tenant.id,
      csrf: "fee-csrf",
      mfa_verified: true,
      expires_at: new Date(Date.now() + 3600000),
    });
    server = f.app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    async function request(path, body, expected = 200) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "smpis_session=fee-test-session",
          "x-csrf-token": "fee-csrf",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result.data;
    }
    const term = await one(db, "SELECT * FROM terms WHERE school_id=$1", [
      f.school.id,
    ]);
    const cls = await insert(db, "classes", {
      school_id: f.school.id,
      academic_year_id: term.academic_year_id,
      name: "Audience class",
      capacity: 30,
    });
    const common = { class_id: cls.id, term_id: term.id };
    const saved = await request("/finance/fee-structures/bulk", {
      ...common,
      fees: [
        { fee_category: "ADMISSION", amount: "50", applies_to: "ALL" },
        { fee_category: "TUITION", amount: "100" },
        { fee_category: "UNIFORM", amount: "30", applies_to: "NEW_INTAKES" },
      ],
    });
    assert.equal(
      saved.find((f) => f.fee_category === "ADMISSION").applies_to,
      "NEW_INTAKES",
      "admission audience cannot be overridden",
    );
    await request(
      "/finance/fee-structures/bulk",
      {
        ...common,
        replace: true,
        fees: [{ fee_category: "TUITION", amount: "0" }],
      },
      422,
    );
    assert.equal(
      (
        await rows(db, "SELECT * FROM fee_structures WHERE class_id=$1", [
          cls.id,
        ])
      ).length,
      3,
      "invalid replacement cannot remove saved fees",
    );
    await request(
      "/finance/fee-structures",
      {
        ...common,
        fee_category: "OTHER",
        amount: "10",
        applies_to: "EVERYONE",
      },
      422,
    );
    await request("/finance/fee-structures", {
      ...common,
      fee_category: "ADMISSION",
      amount: "50",
      applies_to: "RETURNING",
    });
    const newcomer = await insert(db, "students", {
      school_id: f.school.id,
      class_id: cls.id,
      school_entry_term_id: term.id,
      first_name: "New",
      last_name: "Member",
      gender: "OTHER",
      date_of_birth: "2015-01-01",
      guardian_name: "Guardian",
      guardian_phone: "08012345678",
      status: "ENROLLED",
    });
    const returning = await insert(db, "students", {
      school_id: f.school.id,
      class_id: cls.id,
      first_name: "Returning",
      last_name: "Member",
      gender: "OTHER",
      date_of_birth: "2015-01-01",
      guardian_name: "Guardian",
      guardian_phone: "08012345678",
      status: "ENROLLED",
    });
    const results = await request("/finance/invoices/batch", {
      ...common,
      due_date: term.end_date,
    });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.invoice_id));
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT total_cents FROM student_invoices WHERE student_id=$1",
            [newcomer.id],
          )
        ).total_cents,
      ),
      18000,
    );
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT total_cents FROM student_invoices WHERE student_id=$1",
            [returning.id],
          )
        ).total_cents,
      ),
      10000,
    );
    await request("/finance/fee-structures/bulk", {
      ...common,
      replace: true,
      fees: [
        { fee_category: "TUITION", amount: "90", applies_to: "RETURNING" },
      ],
    });
    const remaining = await rows(
      db,
      "SELECT * FROM fee_structures WHERE class_id=$1",
      [cls.id],
    );
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].applies_to, "RETURNING");
    assert.equal(
      (
        await rows(db, "SELECT * FROM invoice_items WHERE invoice_id=$1", [
          results.find((r) => r.student_id === newcomer.id).invoice_id,
        ])
      ).length,
      3,
      "removing fee categories never removes invoiced items",
    );
    await request("/finance/fee-structures/bulk", {
      ...common,
      replace: true,
      fees: [],
    });
    assert.equal(
      (
        await rows(db, "SELECT * FROM fee_structures WHERE class_id=$1", [
          cls.id,
        ])
      ).length,
      0,
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await f.db.close();
  }
});

test("deployment guard rejects databases missing fee eligibility migration", async () => {
  const f = await accountFixture();
  try {
    await checkFeeEligibilitySchema(f.db);
    await f.db.query(
      "ALTER TABLE fee_structures DROP COLUMN applies_to CASCADE",
    );
    await f.db.query(
      "ALTER TABLE students DROP COLUMN school_entry_term_id CASCADE",
    );
    await assert.rejects(
      () => checkFeeEligibilitySchema(f.db),
      /Fee eligibility schema migration is incomplete/,
    );
    await initializeSchema(f.db);
    await checkFeeEligibilitySchema(f.db);
  } finally {
    await f.db.close();
  }
});
