import { openTestDatabase } from "./database.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, before, after } from "./database.js";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as OTPAuth from "otpauth";
import { insert, one, rows } from "../server/db.js";
import { createApp } from "../server/app.js";
import { hashPassword, localClock } from "../server/security.js";
import { refreshOperationAlerts } from "../server/operations-service.js";
import { refreshAlerts } from "../server/services.js";
import { forecastSeries } from "../server/intelligence.js";
process.env.REQUIRE_MFA = "false";
let documentDir;
let db,
  server,
  base,
  school,
  foreign,
  year,
  cls,
  child,
  staff,
  facility,
  asset,
  incident,
  complaint,
  repair,
  vacancy,
  applicant,
  leave,
  invoice;
const users = {},
  clients = {},
  gatewayCalls = [],
  password = "Operations-test-pass!",
  today = localClock("Africa/Lagos").date;
const day = (n) => {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function call(who, path, method = "GET", body, expected = 200) {
  const c = clients[who],
    response = await fetch(base + path, {
      method,
      headers: {
        Cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${who} ${method} ${path}: ${JSON.stringify(result)}`,
  );
  return result.data;
}
async function login(name) {
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: users[name].email, password }),
  });
  assert.equal(res.status, 200);
  const d = (await res.json()).data;
  clients[name] = {
    cookie: res.headers.get("set-cookie").split(";")[0],
    csrf: d.csrf,
  };
  return d;
}
before(async () => {
  db = await openTestDatabase();
  documentDir = await mkdtemp(path.join(tmpdir(), "smpis-hr-test-"));
  const app = await createApp(db, {
    dataDir: documentDir,
    gatewayRequest: async (key, path, body) => {
      gatewayCalls.push({ path, body });
      if (body)
        return {
          authorization_url: "https://checkout.paystack.com/test-checkout",
        };
      const reference = path.split("/").at(-1),
        g = await one(
          db,
          "SELECT * FROM gateway_transactions WHERE reference=$1",
          [reference],
        );
      return {
        id: g.id,
        reference,
        status: "success",
        amount: Number(g.amount_cents),
        currency: g.currency,
        domain: g.mode.toLowerCase(),
      };
    },
  });
  school = await insert(db, "schools", {
    name: "Operations Academy",
    short_code: "OPS",
  });
  foreign = await insert(db, "schools", {
    name: "Other School",
    short_code: "OTH",
  });
  for (const [name, role, sid] of [
    ["admin", "SUPER_ADMIN", school.id],
    ["principal", "PRINCIPAL", school.id],
    ["teacher", "TEACHER", school.id],
    ["otherteacher", "TEACHER", school.id],
    ["hr", "HR_OFFICER", school.id],
    ["facilities", "FACILITIES_MANAGER", school.id],
    ["finance", "FINANCE_OFFICER", school.id],
    ["parent", "PARENT", school.id],
    ["otherparent", "PARENT", school.id],
    ["board", "PROPRIETOR", school.id],
    ["foreign", "SUPER_ADMIN", foreign.id],
  ])
    users[name] = await insert(db, "users", {
      school_id: sid,
      name,
      email: `${name}@operations.test`,
      role,
      password_hash: hashPassword(password),
    });
  await insert(db, "platform_operators", { user_id: users.admin.id });
  year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "Test year",
    start_date: day(-90),
    end_date: day(270),
  });
  const term = await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Term 1",
    start_date: day(-90),
    end_date: day(30),
    is_current: true,
  });
  cls = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Year 5",
    capacity: 30,
    teacher_user_id: users.teacher.id,
  });
  child = await insert(db, "students", {
    school_id: school.id,
    first_name: "Amara",
    last_name: "Obi",
    date_of_birth: "2016-01-01",
    gender: "OTHER",
    guardian_name: "Parent",
    guardian_phone: "08000000000",
    parent_user_id: users.parent.id,
    class_id: cls.id,
    status: "ENROLLED",
  });
  staff = await insert(db, "staff", {
    school_id: school.id,
    user_id: users.teacher.id,
    staff_number: "ST-001",
    first_name: "Teacher",
    last_name: "One",
    department: "Teaching",
    position: "Teacher",
    hire_date: day(-90),
  });
  await insert(db, "fee_structures", {
    school_id: school.id,
    class_id: cls.id,
    term_id: term.id,
    fee_category: "TUITION",
    amount_cents: 100000,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const name of Object.keys(users)) await login(name);
});
after(async () => {
  if (documentDir) await rm(documentDir, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
  await db.close();
  delete process.env.PAYSTACK_SCHOOL_KEYS_JSON;
  delete process.env.PAYSTACK_LIVE_ENABLED;
  delete process.env.APP_URL;
});
test("discipline workflow enforces student scope, ordered stages, notification records and controlled actions", async () => {
  const body = {
    kind: "DISCIPLINE",
    category: "BULLYING",
    description: "Reported incident requires review.",
    event_date: today,
    student_id: child.id,
  };
  await call("parent", "/operations/cases", "POST", body, 403);
  await call("otherteacher", "/operations/cases", "POST", body, 403);
  incident = await call("teacher", "/operations/cases", "POST", body);
  assert.equal(incident.stage, "REPORTED");
  await call(
    "foreign",
    `/operations/cases/${incident.id}`,
    "GET",
    undefined,
    404,
  );
  await call(
    "parent",
    `/operations/cases/${incident.id}`,
    "GET",
    undefined,
    403,
  );
  await call(
    "teacher",
    `/operations/cases/${incident.id}/stage`,
    "POST",
    { stage: "REVIEWED", note: "Review" },
    403,
  );
  await call(
    "principal",
    `/operations/cases/${incident.id}/stage`,
    "POST",
    { stage: "DECISION", note: "Skip" },
    409,
  );
  for (const stage of [
    "REVIEWED",
    "INVESTIGATION",
    "PARENT_NOTIFICATION",
    "DECISION",
  ])
    await call("principal", `/operations/cases/${incident.id}/stage`, "POST", {
      stage,
      note:
        stage === "PARENT_NOTIFICATION"
          ? "Parent contacted by telephone today."
          : "Reviewed evidence.",
    });
  await call(
    "principal",
    `/operations/cases/${incident.id}/stage`,
    "POST",
    { stage: "ACTION_TAKEN", note: "Decision action", action_type: "INVALID" },
    422,
  );
  for (const stage of ["ACTION_TAKEN", "FOLLOW_UP", "CLOSED"])
    await call("principal", `/operations/cases/${incident.id}/stage`, "POST", {
      stage,
      note: "Counselling and follow-up recorded.",
      action_type: "COUNSELLING",
    });
  const result = await call("principal", `/operations/cases/${incident.id}`);
  assert.equal(result.history.length, 7);
  assert.ok(result.parent_notified_at);
  assert.equal(result.action_type, "COUNSELLING");
  for (let n = 0; n < 2; n++)
    await call("teacher", "/operations/cases", "POST", body);
  assert.equal(
    (
      await call(
        "principal",
        `/operations/discipline/repeated?from=${day(-30)}&to=${today}&category=BULLYING`,
      )
    )[0].incidents,
    3,
  );
  await refreshAlerts(db, school.id);
  assert.equal(
    (await one(db, "SELECT status FROM alerts WHERE category='DISCIPLINE'"))
      .status,
    "ACTIVE",
  );
});
test("complaints route by category, isolate parents, enforce progression and preserve feedback", async () => {
  complaint = await call("parent", "/operations/cases", "POST", {
    kind: "COMPLAINT",
    category: "FEES",
    description: "Please explain my fee balance.",
    event_date: today,
    student_id: child.id,
  });
  assert.equal(complaint.assigned_to, users.finance.id);
  assert.equal(
    (await call("otherparent", "/operations/cases?kind=COMPLAINT")).length,
    0,
  );
  await call(
    "otherparent",
    `/operations/cases/${complaint.id}`,
    "GET",
    undefined,
    403,
  );
  assert.ok(
    await one(db, "SELECT id FROM notifications WHERE dedupe_key=$1", [
      `complaint-ack:${complaint.id}`,
    ]),
  );
  await call(
    "finance",
    `/operations/cases/${complaint.id}/assign`,
    "PATCH",
    { assigned_to: users.teacher.id },
    403,
  );
  for (const stage of [
    "ACKNOWLEDGED",
    "ASSIGNED",
    "INVESTIGATED",
    "RESPONSE_PROVIDED",
    "RESOLVED",
  ])
    await call("finance", `/operations/cases/${complaint.id}/stage`, "POST", {
      stage,
      note: "Explanation of billed charges provided.",
    });
  await call(
    "finance",
    `/operations/cases/${complaint.id}/stage`,
    "POST",
    { stage: "PARENT_FEEDBACK", note: "Done", feedback_score: 5 },
    403,
  );
  await call("parent", `/operations/cases/${complaint.id}/stage`, "POST", {
    stage: "PARENT_FEEDBACK",
    note: "Explanation received.",
    feedback_score: 4,
  });
  const overdue = await call("parent", "/operations/cases", "POST", {
    kind: "COMPLAINT",
    category: "OTHER",
    description: "Unresolved request.",
    event_date: today,
  });
  await db.query(
    "UPDATE service_cases SET due_at=now()-interval '2 days' WHERE id=$1",
    [overdue.id],
  );
  await refreshOperationAlerts(db, school.id);
  assert.equal(
    (
      await one(
        db,
        "SELECT status FROM alerts WHERE category='PARENT' AND entity_id=$1",
        [overdue.id],
      )
    ).status,
    "ACTIVE",
  );
});
test("surveys accept one complete response per parent and provide aggregates without respondent identities", async () => {
  const s = await call("principal", "/surveys", "POST", {
    title: "Term feedback",
    questions: ["Teaching", "Safety"],
    start_date: day(-1),
    end_date: day(1),
    published: true,
  });
  await call(
    "parent",
    `/surveys/${s.id}/responses`,
    "POST",
    { answers: [5] },
    422,
  );
  await call("parent", `/surveys/${s.id}/responses`, "POST", {
    answers: [5, 3],
  });
  await call(
    "parent",
    `/surveys/${s.id}/responses`,
    "POST",
    { answers: [1, 1] },
    409,
  );
  await call("otherparent", `/surveys/${s.id}/responses`, "POST", {
    answers: [3, 5],
  });
  const result = await call("board", `/surveys/${s.id}/results`);
  assert.equal(result.responses, 2);
  assert.equal(result.questions[0].average, 4);
  assert.ok(!JSON.stringify(result).includes("parent_user_id"));
  await call("parent", `/surveys/${s.id}/results`, "GET", undefined, 403);
  assert.equal(
    (await call("board", "/operations/summary")).satisfaction_score,
    4,
  );
});
test("facilities preserve asset relationships, urgent alerts and mandatory closure costs", async () => {
  facility = await call("facilities", "/facilities", "POST", {
    name: "Science laboratory",
    category: "LABORATORY",
    location: "Block B",
    condition: "GOOD",
  });
  asset = await call("facilities", "/assets", "POST", {
    facility_id: facility.id,
    asset_code: "LAB-001",
    description: "Microscope",
    purchase_date: today,
    purchase_value: "1200.50",
    condition: "GOOD",
  });
  assert.equal(Number(asset.purchase_value_cents), 120050);
  await call("parent", "/facilities", "POST", { name: "Invalid" }, 403);
  repair = await call("teacher", "/operations/cases", "POST", {
    kind: "MAINTENANCE",
    category: "SAFETY",
    description: "Unsafe electrical socket.",
    event_date: today,
    priority: "URGENT",
    facility_id: facility.id,
    asset_id: asset.id,
  });
  assert.ok(
    await one(
      db,
      "SELECT id FROM alerts WHERE category='FACILITIES' AND entity_id=$1",
      [repair.id],
    ),
  );
  await call(
    "otherteacher",
    `/operations/cases/${repair.id}`,
    "GET",
    undefined,
    403,
  );
  await call(
    "facilities",
    `/operations/cases/${repair.id}/stage`,
    "POST",
    { stage: "ASSIGNED", note: "Assigned" },
    422,
  );
  await call("facilities", `/operations/cases/${repair.id}/assign`, "PATCH", {
    assigned_to: users.facilities.id,
  });
  for (const stage of ["ASSIGNED", "IN_PROGRESS", "COMPLETED"])
    await call("facilities", `/operations/cases/${repair.id}/stage`, "POST", {
      stage,
      note: "Work recorded.",
    });
  await call(
    "facilities",
    `/operations/cases/${repair.id}/stage`,
    "POST",
    { stage: "COST_RECORDED", note: "No charge" },
    422,
  );
  await call("facilities", `/operations/cases/${repair.id}/stage`, "POST", {
    stage: "COST_RECORDED",
    note: "Warranty repair",
    cost: "0",
  });
  await call("facilities", `/operations/cases/${repair.id}/stage`, "POST", {
    stage: "CLOSED",
    note: "Safety inspection complete.",
  });
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM maintenance_history WHERE case_id=$1",
        [repair.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT status FROM alerts WHERE category='FACILITIES' AND entity_id=$1",
        [repair.id],
      )
    ).status,
    "RESOLVED",
  );
});
test("recruitment logs decisions and hiring creates exactly one staff record", async () => {
  vacancy = await call("hr", "/hr/vacancies", "POST", {
    title: "Science teacher",
    department: "Sciences",
    description: "Teach science classes.",
    closing_date: day(30),
  });
  applicant = await call("hr", "/hr/applicants", "POST", {
    vacancy_id: vacancy.id,
    first_name: "New",
    last_name: "Teacher",
    email: "candidate@example.test",
    phone: "08000000001",
    qualifications: "BEd Science",
  });
  await call("teacher", "/hr/applicants", "POST", {}, 403);
  await call(
    "hr",
    `/hr/applicants/${applicant.id}/stage`,
    "POST",
    { stage: "HIRED", note: "Skip" },
    409,
  );
  for (const stage of ["SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED"])
    await call("hr", `/hr/applicants/${applicant.id}/stage`, "POST", {
      stage,
      note: "Assessment evidence recorded.",
      interview_at: new Date().toISOString(),
      hire_date: today,
    });
  assert.ok(
    (
      await one(db, "SELECT staff_id FROM job_applicants WHERE id=$1", [
        applicant.id,
      ])
    ).staff_id,
  );
  await call(
    "hr",
    `/hr/applicants/${applicant.id}/stage`,
    "POST",
    { stage: "HIRED", note: "Again", hire_date: today },
    409,
  );
  assert.equal(
    (await call("hr", `/hr/applicants/${applicant.id}/history`)).length,
    4,
  );
});
test("leave routes to supervisors, prevents self approval and marks approved attendance without overwriting check-ins", async () => {
  await call("hr", `/hr/staff/${staff.id}/profile`, "PATCH", {
    supervisor_user_id: users.principal.id,
    qualifications: "BEd",
    training: "Annual training",
  });
  leave = await call("teacher", "/hr/leave", "POST", {
    start_date: day(2),
    end_date: day(4),
    reason: "Family leave",
  });
  await call(
    "teacher",
    `/hr/leave/${leave.id}/decision`,
    "POST",
    { status: "APPROVED", note: "Self approve" },
    403,
  );
  await call(
    "hr",
    `/hr/leave/${leave.id}/decision`,
    "POST",
    { status: "APPROVED", note: "Before review" },
    409,
  );
  await call("principal", `/hr/leave/${leave.id}/decision`, "POST", {
    status: "REVIEWED",
    note: "Coverage arranged.",
  });
  await call("hr", `/hr/leave/${leave.id}/decision`, "POST", {
    status: "APPROVED",
    note: "Approved by HR.",
  });
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM staff_attendance WHERE staff_id=$1 AND status='LEAVE'",
        [staff.id],
      )
    ).n,
    [2, 3, 4].filter(
      (offset) =>
        ![0, 6].includes(new Date(day(offset) + "T12:00:00Z").getUTCDay()),
    ).length,
  );
  await call(
    "teacher",
    "/hr/leave",
    "POST",
    { start_date: day(3), end_date: day(5), reason: "Overlap" },
    409,
  );
  let previousWorkday = -1;
  while (
    [0, 6].includes(new Date(day(previousWorkday) + "T12:00:00Z").getUTCDay())
  )
    previousWorkday--;
  const conflict = await call("teacher", "/hr/leave", "POST", {
    start_date: day(previousWorkday),
    end_date: day(previousWorkday),
    reason: "Late application",
  });
  await insert(db, "staff_attendance", {
    school_id: school.id,
    staff_id: staff.id,
    attendance_date: day(previousWorkday),
    status: "PRESENT",
    check_in_time: new Date().toISOString(),
  });
  await call("principal", `/hr/leave/${conflict.id}/decision`, "POST", {
    status: "REVIEWED",
    note: "Reviewed",
  });
  await call(
    "hr",
    `/hr/leave/${conflict.id}/decision`,
    "POST",
    { status: "APPROVED", note: "Conflicts" },
    409,
  );
  assert.equal((await call("otherteacher", "/hr/overview")).leave.length, 0);
});
test("staff performance snapshots use recorded evidence and expose missing metrics", async () => {
  await insert(db, "staff_attendance", {
    school_id: school.id,
    staff_id: staff.id,
    attendance_date: day(1),
    status: "PRESENT",
  });
  const review = await call("hr", "/hr/reviews", "POST", {
    staff_id: staff.id,
    academic_year_id: year.id,
    development_score: 70,
    notes: "Training attended; objective evidence.",
  });
  assert.equal(Number(review.overall_score), 90);
  assert.equal(review.snapshot.metrics.attendance, 100);
  assert.equal(review.snapshot.metrics.curriculum, null);
  assert.deepEqual(review.snapshot.missing_metrics, ["curriculum"]);
  await call("teacher", "/hr/reviews", "POST", {}, 403);
  assert.equal((await call("teacher", "/hr/overview")).reviews.length, 0);
});
test("batch billing is idempotent and keeps per-student results visible", async () => {
  const term = await one(
      db,
      "SELECT id FROM terms WHERE school_id=$1 AND is_current",
      [school.id],
    ),
    body = { class_id: cls.id, term_id: term.id, due_date: day(10) };
  const first = await call("finance", "/finance/invoices/batch", "POST", body),
    second = await call("finance", "/finance/invoices/batch", "POST", body);
  assert.equal(first[0].invoice_id, second[0].invoice_id);
  invoice = await one(db, "SELECT * FROM student_invoices WHERE id=$1", [
    first[0].invoice_id,
  ]);
  await call("parent", "/finance/invoices/batch", "POST", body, 403);
});
test("intelligence refuses unsupported forecasts and rolling tests never use future values", async () => {
  assert.equal(
    forecastSeries([{ month: "2026-01", value: 100 }]).forecast_cents,
    null,
  );
  const f = forecastSeries(
    [10, 20, 30, 40, 50, 60].map((value, i) => ({
      month: `2026-0${i + 1}`,
      value,
    })),
  );
  assert.equal(f.forecast_cents, 50);
  assert.equal(f.backtest[0].predicted, 20);
  assert.equal(f.mae_cents, 20);
  const d = await call("board", "/intelligence");
  assert.equal(d.forecast.status, "INSUFFICIENT_HISTORY");
  assert.ok(!JSON.stringify(d).includes("Amara"));
  await call("parent", "/intelligence", "GET", undefined, 403);
});
test("school provisioning requires a platform operator and new administrators remain isolated", async () => {
  await call("foreign", "/platform/schools", "GET", undefined, 403);
  const s = await call(
    "admin",
    "/platform/schools",
    "POST",
    {
      name: "New School",
      short_code: "NEW",
      currency_code: "NGN",
      timezone: "Africa/Lagos",
      admin_name: "New administrator",
      admin_email: "newadmin@example.test",
      admin_password: password,
      year_name: "New year",
      start_date: day(-10),
      end_date: day(300),
    },
    201,
  );
  assert.notEqual(s.id, school.id);
  const u = await one(db, "SELECT id FROM users WHERE school_id=$1", [s.id]);
  assert.equal(
    await one(db, "SELECT * FROM platform_operators WHERE user_id=$1", [u.id]),
    undefined,
  );
  const schools = await call("admin", "/platform/schools");
  assert.equal(schools.length, 3);
  assert.ok(!JSON.stringify(schools).includes("password"));
});
test("Paystack validates signature, tenant, amount, mode and duplicate callbacks before crediting an invoice", async () => {
  process.env.APP_URL = "https://smpis.com";
  process.env.PAYSTACK_LIVE_ENABLED = "true";
  process.env.PAYSTACK_SCHOOL_KEYS_JSON = JSON.stringify({
    [school.id]: "sk_live_local_fixture",
  });
  const g = await call("parent", "/payments/paystack/initialize", "POST", {
    invoice_id: invoice.id,
    amount: "100.00",
  });
  assert.equal(gatewayCalls.at(-1).body.amount, 10000);
  assert.equal(gatewayCalls.at(-1).body.currency, "NGN");
  await call(
    "otherparent",
    "/payments/paystack/verify",
    "POST",
    { reference: g.reference },
    404,
  );
  async function webhook(data, key = "sk_live_local_fixture") {
    const body = JSON.stringify({ event: "charge.success", data });
    return fetch(base + `/webhooks/paystack/${school.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": createHmac("sha512", key)
          .update(body)
          .digest("hex"),
      },
      body,
    });
  }
  const data = {
    id: 111,
    reference: g.reference,
    status: "success",
    amount: 10000,
    currency: "NGN",
    domain: "live",
  };
  assert.equal((await webhook(data, "wrong")).status, 401);
  assert.equal((await webhook({ ...data, amount: 10001 })).status, 422);
  assert.equal((await webhook({ ...data, currency: "USD" })).status, 422);
  assert.equal((await webhook({ ...data, domain: "test" })).status, 422);
  assert.equal((await webhook(data)).status, 200);
  assert.equal((await webhook(data)).status, 200);
  await call("parent", "/payments/paystack/verify", "POST", {
    reference: g.reference,
  });
  assert.equal(
    Number(
      (
        await one(db, "SELECT paid_cents FROM student_invoices WHERE id=$1", [
          invoice.id,
        ])
      ).paid_cents,
    ),
    10000,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM payments WHERE reference_number=$1",
        [g.reference],
      )
    ).n,
    1,
  );
  const g2 = await call("parent", "/payments/paystack/initialize", "POST", {
    invoice_id: invoice.id,
    amount: "900.00",
  });
  await db.query(
    "UPDATE student_invoices SET paid_cents=total_cents WHERE id=$1",
    [invoice.id],
  );
  assert.equal(
    (
      await webhook({
        ...data,
        id: 112,
        reference: g2.reference,
        amount: 90000,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT status FROM gateway_transactions WHERE reference=$1",
        [g2.reference],
      )
    ).status,
    "REVIEW",
  );
  await db.query("UPDATE student_invoices SET paid_cents=10000 WHERE id=$1", [
    invoice.id,
  ]);
  process.env.PAYSTACK_SCHOOL_KEYS_JSON = JSON.stringify({
    [school.id]: "sk_test_local_fixture",
  });
  const g3 = await call("parent", "/payments/paystack/initialize", "POST", {
    invoice_id: invoice.id,
    amount: "10.00",
  });
  assert.equal(
    (
      await call("parent", "/payments/paystack/verify", "POST", {
        reference: g3.reference,
      })
    ).status,
    "TEST_CONFIRMED",
  );
  assert.equal(
    Number(
      (
        await one(db, "SELECT paid_cents FROM student_invoices WHERE id=$1", [
          invoice.id,
        ])
      ).paid_cents,
    ),
    10000,
  );
});
test("expanded reports and management alerts enforce scope and produce valid downloads", async () => {
  for (const key of [
    "attendance-summary",
    "chronic-absence",
    "discipline",
    "complaints",
    "maintenance",
    "staff-performance",
  ])
    for (const format of ["csv", "xlsx", "pdf"]) {
      const c = clients.admin,
        response = await fetch(
          `${base}/reports/${key}?from=${day(-90)}&to=${today}&format=${format}`,
          { headers: { Cookie: c.cookie } },
        ),
        bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200, `${key}.${format}`);
      assert.ok(bytes.length > 20);
      if (format === "pdf")
        assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
      if (format === "xlsx")
        assert.equal(bytes.subarray(0, 2).toString(), "PK");
    }
  await call("parent", "/reports/complaints?format=csv", "GET", undefined, 403);
  const term = await one(
    db,
    "SELECT id FROM terms WHERE school_id=$1 AND is_current",
    [school.id],
  );
  await insert(db, "at_risk_flags", {
    school_id: school.id,
    student_id: child.id,
    term_id: term.id,
    class_id: cls.id,
    reason: "GRADE_DECLINE",
    detail: "Academic support needed.",
  });
  const subject = await insert(db, "subjects", {
      school_id: school.id,
      name: "Science",
      code: "SCI",
      department: "Science",
    }),
    assignment = await insert(db, "class_subjects", {
      school_id: school.id,
      class_id: cls.id,
      subject_id: subject.id,
      teacher_user_id: users.teacher.id,
    });
  await insert(db, "curriculum_topics", {
    school_id: school.id,
    class_subject_id: assignment.id,
    term_id: term.id,
    topic_name: "Matter",
    planned_week: 1,
    sequence_order: 1,
  });
  const alerts = await call("admin", "/alerts");
  assert.ok(alerts.some((a) => a.category === "ACADEMIC"));
  assert.ok(
    alerts.some(
      (a) => a.category === "CURRICULUM" && a.message.includes("Matter"),
    ),
  );
  const academic = alerts.find((a) => a.category === "ACADEMIC");
  assert.deepEqual(await call("parent", "/alerts"), []);
  await call("parent", `/alerts/${academic.id}/acknowledge`, "PATCH", {}, 403);
  await call("admin", `/alerts/${academic.id}/acknowledge`, "PATCH", {});
  assert.equal(
    (await one(db, "SELECT status FROM alerts WHERE id=$1", [academic.id]))
      .status,
    "ACKNOWLEDGED",
  );
});
test("MFA recovery codes are hashed, consumed once, and cannot be reused", async () => {
  const mfa = await call("teacher", "/auth/mfa/setup", "POST", {});
  const otp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(mfa.secret),
  }).generate();
  await call("teacher", "/auth/mfa/enable", "POST", { code: otp });
  const codes = (
    await call("teacher", "/auth/mfa/recovery-codes", "POST", { password })
  ).codes;
  assert.equal(codes.length, 10);
  const hashes = await rows(
    db,
    "SELECT code_hash FROM mfa_recovery_codes WHERE user_id=$1",
    [users.teacher.id],
  );
  assert.ok(hashes.every((h) => !codes.includes(h.code_hash)));
  assert.equal((await login("teacher")).mfa_required, true);
  await call("teacher", "/operations/setup", "GET", undefined, 403);
  await call("teacher", "/auth/mfa/verify", "POST", { code: codes[0] });
  await call("teacher", "/operations/setup");
  await login("teacher");
  await call("teacher", "/auth/mfa/verify", "POST", { code: codes[0] }, 422);
  await call("teacher", "/auth/mfa/verify", "POST", { code: codes[1] });
});

test("working calendars exclude holidays, enforce annual limits and cancellations restore attendance", async () => {
  // A fixed future week makes weekday/holiday expectations independent of today's weekday.
  await call("hr", "/hr/calendar", "POST", {
    weekdays: [1, 2, 3, 4, 5],
    annual_leave_days: 3,
    holidays: [{ date: "2030-01-08", name: "School holiday" }],
    reason: "School leave calendar",
  });
  const estimate = await call(
    "teacher",
    "/hr/leave/estimate?from=2030-01-07&to=2030-01-13",
  );
  assert.deepEqual(estimate.dates, [
    "2030-01-07",
    "2030-01-09",
    "2030-01-10",
    "2030-01-11",
  ]);
  await call("parent", "/hr/calendar", "GET", undefined, 403);
  const req = await call("teacher", "/hr/leave", "POST", {
    start_date: "2030-01-07",
    end_date: "2030-01-13",
    reason: "Holiday adjusted leave",
  });
  await call("principal", `/hr/leave/${req.id}/decision`, "POST", {
    status: "REVIEWED",
    note: "Reviewed coverage",
  });
  await call(
    "hr",
    `/hr/leave/${req.id}/decision`,
    "POST",
    { status: "APPROVED", note: "Over balance" },
    422,
  );
  await call("hr", "/hr/calendar", "POST", {
    weekdays: [1, 2, 3, 4, 5],
    annual_leave_days: 4,
    holidays: [{ date: "2030-01-08", name: "School holiday" }],
    reason: "Update agreed entitlement",
  });
  const absent = await insert(db, "staff_attendance", {
    school_id: school.id,
    staff_id: staff.id,
    attendance_date: "2030-01-07",
    status: "ABSENT",
  });
  await call("hr", `/hr/leave/${req.id}/decision`, "POST", {
    status: "APPROVED",
    note: "Approved within balance",
  });
  assert.equal(
    (
      await one(db, "SELECT working_days FROM leave_requests WHERE id=$1", [
        req.id,
      ])
    ).working_days,
    4,
  );
  await call(
    "teacher",
    `/hr/leave/${req.id}/cancel`,
    "POST",
    { reason: "Self cancel approval" },
    403,
  );
  await call(
    "foreign",
    `/hr/leave/${req.id}/cancel`,
    "POST",
    { reason: "Wrong school" },
    404,
  );
  await call("hr", `/hr/leave/${req.id}/cancel`, "POST", {
    reason: "Dates changed; apply again",
  });
  assert.equal(
    (
      await one(db, "SELECT status FROM staff_attendance WHERE id=$1", [
        absent.id,
      ])
    ).status,
    "ABSENT",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM staff_attendance WHERE staff_id=$1 AND attendance_date BETWEEN '2030-01-07' AND '2030-01-13'",
        [staff.id],
      )
    ).n,
    1,
  );
  const replacement = await call("teacher", "/hr/leave", "POST", {
    start_date: "2030-01-07",
    end_date: "2030-01-13",
    reason: "Replacement date request",
  });
  await call("teacher", `/hr/leave/${replacement.id}/cancel`, "POST", {
    reason: "Withdraw pending request",
  });
  await call(
    "hr",
    `/hr/leave/${req.id}/decision`,
    "POST",
    { status: "APPROVED", note: "Replay approval" },
    409,
  );
});

test("private HR uploads verify format, preserve bytes and deny other schools and staff", async () => {
  const bytes = Buffer.from("%PDF-1.4\nHR contract test fixture\n%%EOF");
  async function upload(who, content) {
    const form = new FormData();
    form.set("category", "CONTRACT");
    form.set("file", new Blob([content]), "contract.pdf");
    const c = clients[who];
    return fetch(`${base}/hr/staff/${staff.id}/documents`, {
      method: "POST",
      headers: { Cookie: c.cookie, "x-csrf-token": c.csrf },
      body: form,
    });
  }
  assert.equal((await upload("teacher", bytes)).status, 403);
  assert.equal((await upload("foreign", bytes)).status, 404);
  assert.equal(
    (await upload("hr", Buffer.from("<script>bad</script>"))).status,
    422,
  );
  const response = await upload("hr", bytes);
  assert.equal(response.status, 200);
  const doc = (await response.json()).data;
  const download = await fetch(`${base}/hr/documents/${doc.id}`, {
    headers: { Cookie: clients.hr.cookie },
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  await call("foreign", `/hr/documents/${doc.id}`, "GET", undefined, 404);
  await call("parent", `/hr/documents/${doc.id}`, "GET", undefined, 403);
  const listed = await call("hr", `/hr/staff/${staff.id}/documents`);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].storage_key, undefined);
});

test("review amendments retain immutable evidence and reject stale versions; survey drafts publish once", async () => {
  const review = await one(
      db,
      "SELECT * FROM performance_reviews WHERE staff_id=$1",
      [staff.id],
    ),
    body = {
      revision: review.revision,
      development_score: 85,
      notes: "Additional training certificate recorded",
      reason: "Late certificate provided",
    };
  await call("hr", `/hr/reviews/${review.id}/amend`, "POST", body);
  const history = await call("hr", `/hr/reviews/${review.id}/history`);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].record.snapshot, review.snapshot);
  assert.equal(Number(history[0].record.development_score), 70);
  await call("hr", `/hr/reviews/${review.id}/amend`, "POST", body, 409);
  await call(
    "teacher",
    `/hr/reviews/${review.id}/history`,
    "GET",
    undefined,
    403,
  );
  await call(
    "foreign",
    `/hr/reviews/${review.id}/history`,
    "GET",
    undefined,
    404,
  );
  const survey = await call("principal", "/surveys", "POST", {
    title: "Draft check",
    questions: ["Teaching"],
    start_date: day(-1),
    end_date: day(7),
    published: false,
  });
  const edit = {
    title: "Published check",
    questions: ["Teaching quality", "Communication"],
    start_date: today,
    end_date: day(7),
    published: true,
    reason: "Questionnaire reviewed",
  };
  await call("principal", `/surveys/${survey.id}`, "PATCH", edit);
  await call("principal", `/surveys/${survey.id}`, "PATCH", edit, 409);
  assert.ok(
    (await call("parent", "/surveys")).some(
      (s) => s.id === survey.id && s.questions.length === 2,
    ),
  );
});

test("historical model imports are tenant-scoped, validated, auditable and never activate predictions", async () => {
  const input = {
    kind: "REVENUE",
    name: "Observed old receipts",
    source_note:
      "Finance ledger monthly totals verified for school test fixture",
    historical_observations_confirmed: true,
    records: [{ month: "2020-01", value: 10000 }],
  };
  await call("parent", "/intelligence/datasets", "POST", input, 403);
  await call(
    "admin",
    "/intelligence/datasets",
    "POST",
    {
      ...input,
      records: [...input.records, { month: "2020-03", value: 30000 }],
    },
    422,
  );
  const d = await call("admin", "/intelligence/datasets", "POST", input);
  assert.equal(d.checksum.length, 64);
  await call(
    "foreign",
    `/intelligence/datasets/${d.id}/evaluate`,
    "POST",
    {},
    404,
  );
  const run = await call(
    "admin",
    `/intelligence/datasets/${d.id}/evaluate`,
    "POST",
    {},
  );
  assert.equal(run.status, "INSUFFICIENT_DATA");
  assert.equal(run.report.production_enabled, false);
  assert.equal(
    (await call("foreign", "/intelligence/models")).datasets.length,
    0,
  );
  assert.equal(
    (await call("admin", "/intelligence/models")).runs[0].artifact,
    undefined,
  );
});
