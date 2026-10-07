import { testMailbox } from "./mailbox.js";
const verifyFixtureEmail = testMailbox();
import { openTestDatabase } from "./database.js";
import { test, before, after } from "./database.js";
import assert from "node:assert/strict";
import { one, insert } from "../server/db.js";
import { createApp } from "../server/app.js";
import { hashPassword, cents, localClock } from "../server/security.js";
import ExcelJS from "exceljs";
import * as OTPAuth from "otpauth";
import { runJobs } from "../server/jobs.js";
import { acquireDataLock } from "../server/backup.js";
import { mkdir } from "node:fs/promises";
process.env.REQUIRE_MFA = "false";

let db,
  server,
  base,
  admin,
  teacher,
  parent,
  finance,
  principal,
  proprietor,
  term,
  cls,
  otherClass,
  student,
  application,
  invoice;
const today = localClock("Africa/Lagos").date;
const year = Number(today.slice(0, 4));
async function client(
  email = "admin@test.school",
  password = "Test-password-2026!",
) {
  await verifyFixtureEmail(email, base);
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  const data = (await login.json()).data,
    cookie = login.headers.get("set-cookie").split(";")[0];
  return {
    cookie,
    csrf: data.csrf,
    async request(path, method = "GET", body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "x-csrf-token": data.csrf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {}
      return {
        status: res.status,
        data: json?.data,
        errors: json?.errors,
        text,
      };
    },
  };
}
async function expect(c, path, method, body, status = 200) {
  const r = await c.request(path, method, body);
  assert.equal(r.status, status, `${method} ${path}: ${r.text}`);
  return r.data;
}
before(async () => {
  db = await openTestDatabase();
  const app = await createApp(db, { dataDir: "test-results/data" });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test("initial setup is one-time and authentication requires a valid session", async () => {
  const status = await fetch(base + "/auth/setup");
  assert.equal((await status.json()).data.required, true);
  const data = {
    school_name: "Test Academy", phone_number: "+2348012345678",
    short_code: "TEST",
    currency_code: "NGN",
    timezone: "Africa/Lagos",
    name: "Test Administrator",
    email: "admin@test.school",
    password: "Test-password-2026!",
    year_name: `${year}/${year + 1}`,
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
  };
  const setup = await fetch(base + "/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assert.equal(setup.status, 201, await setup.text());
  assert.equal((await fetch(base + "/students")).status, 401);
  assert.equal(
    (
      await fetch(base + "/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ).status,
    409,
  );
  admin = await client();
  term = (await expect(admin, "/config")).terms[0];
});
test("account provisioning, class assignment and CSRF enforcement", async () => {
  const accounts = [
    ["Teacher", "TEACHER"],
    ["Parent", "PARENT"],
    ["Finance", "FINANCE_OFFICER"],
    ["Principal", "PRINCIPAL"],
    ["Board", "PROPRIETOR"],
  ];
  let teacherId;
  for (const [name, role] of accounts) {
    const u = await expect(
      admin,
      "/users",
      "POST",
      {
        name,
        email: `${name.toLowerCase()}@test.school`,
        password: "Test-password-2026!",
        role,
      },
      201,
    );
    if (role === "TEACHER") teacherId = u.id;
  }
  teacher = await client("teacher@test.school");
  parent = await client("parent@test.school");
  finance = await client("finance@test.school");
  principal = await client("principal@test.school");
  proprietor = await client("board@test.school");
  cls = await expect(admin, "/classes", "POST", {
    name: "Grade 5A",
    academic_year_id: term.academic_year_id,
    capacity: 1,
    teacher_user_id: teacherId,
  });
  otherClass = await expect(admin, "/classes", "POST", {
    name: "Grade 5B",
    academic_year_id: term.academic_year_id,
    capacity: 30,
  });
  assert.equal((await expect(teacher, "/classes")).length, 1);
  const csrf = await fetch(base + "/classes", {
    method: "POST",
    headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bad" }),
  });
  assert.equal(csrf.status, 403);
  await expect(teacher, "/users", "GET", undefined, 403);
  await expect(proprietor, "/students", "GET", undefined, 403);
  await expect(principal, "/finance/invoices", "GET", undefined, 403);
});
test("application requires guardian and real dates; stage skipping is rejected", async () => {
  const b = {
    first_name: "Amara",
    last_name: "Obi",
    gender: "FEMALE",
    date_of_birth: "2016-04-12",
    guardian_name: "Ada Obi",
    guardian_phone: "08000000000",
    guardian_email: "ada@example.test",
    applied_class_id: cls.id,
  };
  await expect(
    admin,
    "/admissions/applications",
    "POST",
    { ...b, guardian_phone: "" },
    422,
  );
  await expect(
    admin,
    "/admissions/applications",
    "POST",
    { ...b, date_of_birth: "2016-02-31" },
    422,
  );
  application = await expect(admin, "/admissions/applications", "POST", b, 201);
  student = application.student_id;
  await expect(
    admin,
    `/admissions/applications/${application.id}/stage`,
    "PATCH",
    { stage: "OFFERED" },
    422,
  );
  await expect(
    admin,
    `/admissions/applications/${application.id}/stage`,
    "PATCH",
    { stage: "REJECTED", notes: "" },
    422,
  );
  for (const stage of [
    "REVIEWED",
    "ASSESSMENT_SCHEDULED",
    "DECISION_PENDING",
    "OFFERED",
    "FEES_PENDING",
  ])
    await expect(
      admin,
      `/admissions/applications/${application.id}/stage`,
      "PATCH",
      { stage, notes: "Reviewed" },
    );
  await expect(
    admin,
    `/admissions/applications/${application.id}/enroll`,
    "POST",
    { term_id: term.id },
    422,
  );
});
test("billing applies concessions exactly and is idempotent", async () => {
  await expect(finance, "/finance/fee-structures", "POST", {
    class_id: cls.id,
    term_id: term.id,
    fee_category: "TUITION",
    amount: "1000.10",
  });
  await expect(finance, "/finance/fee-structures", "POST", {
    class_id: cls.id,
    term_id: term.id,
    fee_category: "BOARDING",
    amount: "250",
  });
  await expect(finance, `/finance/students/${student}/concessions`, "PATCH", {
    discount_percent: 10,
    scholarship_percent: 10,
  });
  invoice = await expect(finance, "/finance/invoices/generate", "POST", {
    student_id: student,
    term_id: term.id,
    due_date: today,
  });
  assert.equal(Number(invoice.total_cents), 81008);
  const repeated = await expect(finance, "/finance/invoices/generate", "POST", {
    student_id: student,
    term_id: term.id,
    due_date: today,
  });
  assert.equal(invoice.id, repeated.id);
  const details = await expect(finance, `/finance/invoices/${invoice.id}`);
  assert.equal(details.items.length, 3);
  assert.throws(() => cents("1.001"));
  assert.equal(cents("0.10"), 10);
});
test("payments support exact partial/full balances and reject overpayments and replay mismatches", async () => {
  const body = {
    invoice_id: invoice.id,
    amount: "300.01",
    payment_method: "BANK_TRANSFER",
    reference_number: "BANK-1",
    idempotency_key: "payment-1",
  };
  const payment = await expect(finance, "/finance/payments", "POST", body);
  const again = await expect(finance, "/finance/payments", "POST", body);
  assert.equal(payment.id, again.id);
  await expect(
    finance,
    "/finance/payments",
    "POST",
    { ...body, amount: "301" },
    409,
  );
  assert.equal(
    (await expect(finance, "/finance/invoices"))[0].status,
    "PARTIAL",
  );
  await expect(
    finance,
    "/finance/payments",
    "POST",
    { ...body, amount: "600", idempotency_key: "overpay" },
    422,
  );
  await expect(
    admin,
    `/admissions/applications/${application.id}/enroll`,
    "POST",
    { term_id: term.id },
    422,
  );
  await expect(finance, "/finance/payments", "POST", {
    ...body,
    amount: "510.07",
    idempotency_key: "payment-2",
  });
  assert.equal((await expect(finance, "/finance/invoices"))[0].status, "PAID");
  const receipt = await fetch(
    `${base}/finance/payments/${payment.id}/receipt`,
    { headers: { Cookie: finance.cookie } },
  );
  assert.equal(receipt.status, 200);
  assert.ok(
    Buffer.from(await receipt.arrayBuffer())
      .subarray(0, 5)
      .equals(Buffer.from("%PDF-")),
  );
});
test("enrollment creates a unique student number and enforces class capacity", async () => {
  const enrolled = await expect(
    admin,
    `/admissions/applications/${application.id}/enroll`,
    "POST",
    { term_id: term.id },
  );
  assert.match(enrolled.student_number, /^TEST-/);
  await expect(
    admin,
    `/admissions/applications/${application.id}/enroll`,
    "POST",
    { term_id: term.id },
    422,
  );
  const b = await expect(
    admin,
    "/admissions/applications",
    "POST",
    {
      first_name: "Chinedu",
      last_name: "Eze",
      gender: "MALE",
      date_of_birth: "2016-05-12",
      guardian_name: "Ife Eze",
      guardian_phone: "08000000001",
      applied_class_id: cls.id,
    },
    201,
  );
  for (const stage of [
    "REVIEWED",
    "ASSESSMENT_SCHEDULED",
    "DECISION_PENDING",
    "OFFERED",
    "FEES_PENDING",
  ])
    await expect(admin, `/admissions/applications/${b.id}/stage`, "PATCH", {
      stage,
    });
  const i = await expect(finance, "/finance/invoices/generate", "POST", {
    student_id: b.student_id,
    term_id: term.id,
    due_date: today,
  });
  await expect(finance, `/finance/invoices/${i.id}/waive`, "POST", {
    reason: "Scholarship admission",
  });
  await expect(
    admin,
    `/admissions/applications/${b.id}/enroll`,
    "POST",
    { term_id: term.id },
    422,
  );
});
test("parent and teacher access is restricted to linked children and assigned classes", async () => {
  assert.equal((await expect(parent, "/students")).length, 0);
  await expect(parent, `/students/${student}`, "GET", undefined, 404);
  const parentUser = await one(db, "SELECT id FROM users WHERE role='PARENT'");
  await expect(admin, `/students/${student}`, "PATCH", {
    parent_user_id: parentUser.id,
  });
  assert.equal((await expect(parent, "/students")).length, 1);
  await expect(parent, `/students/${student}`, "PATCH", {
    address: "New address",
    guardian_phone: "08012345678",
  });
  await expect(
    parent,
    `/students/${student}`,
    "PATCH",
    { discount_percent: 99 },
    422,
  );
  assert.equal((await expect(parent, "/finance/invoices")).length, 1);
  await expect(
    teacher,
    `/attendance/students?class_id=${otherClass.id}&date=${today}`,
    "GET",
    undefined,
    403,
  );
  const teacherProfile = await expect(teacher, `/students/${student}`);
  assert.equal(teacherProfile.medical_info, undefined);
});
test("attendance rejects foreign class, duplicates, future dates; upserts and alerts work", async () => {
  const body = {
    class_id: cls.id,
    date: today,
    records: [{ student_id: student, status: "PRESENT" }],
  };
  await expect(admin, "/attendance/unlock", "POST", {
    class_id: cls.id,
    date: today,
  });
  await expect(
    teacher,
    "/attendance/students",
    "POST",
    { ...body, records: [...body.records, ...body.records] },
    422,
  );
  await expect(
    teacher,
    "/attendance/students",
    "POST",
    { ...body, class_id: otherClass.id },
    403,
  );
  await expect(
    teacher,
    "/attendance/students",
    "POST",
    { ...body, date: `${year + 1}-01-01` },
    422,
  );
  await expect(teacher, "/attendance/students", "POST", body);
  await expect(teacher, "/attendance/students", "POST", {
    ...body,
    records: [{ student_id: student, status: "ABSENT" }],
  });
  assert.equal(
    Number(
      (
        await one(
          db,
          "SELECT count(*) AS n FROM student_attendance WHERE student_id=$1",
          [student],
        )
      ).n,
    ),
    1,
  );
  for (const offset of [1, 2]) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    const day = d.toISOString().slice(0, 10);
    await expect(
      teacher,
      "/attendance/students",
      "POST",
      { ...body, date: day },
      423,
    );
    await expect(admin, "/attendance/unlock", "POST", {
      class_id: cls.id,
      date: day,
    });
    await expect(teacher, "/attendance/students", "POST", {
      ...body,
      date: day,
      records: [{ student_id: student, status: "ABSENT" }],
    });
  }
  assert.ok(
    (await expect(principal, "/alerts")).some(
      (a) => a.category === "ATTENDANCE",
    ),
  );
  assert.equal((await expect(proprietor, "/alerts")).length, 0);
  const summary = await expect(
    proprietor,
    `/dashboard/executive?term_id=${term.id}`,
  );
  assert.equal(summary.enrollment.enrolled, 1);
  assert.ok(summary.alertSummary.length);
  assert.equal(JSON.stringify(summary).includes("Amara"), false);
});
test("staff check-in duplicates rejected; staff can only check themselves in", async () => {
  const u = await one(db, "SELECT id FROM users WHERE role='TEACHER'");
  const s = await expect(admin, "/hr/staff", "POST", {
    first_name: "Test",
    last_name: "Teacher",
    department: "Primary",
    position: "Teacher",
    hire_date: today,
    employment_type: "FULL_TIME",
    user_id: u.id,
  });
  await expect(teacher, "/attendance/staff/check-in", "POST", {});
  await expect(teacher, "/attendance/staff/check-in", "POST", {}, 409);
  await expect(teacher, "/attendance/staff/check-out", "POST", {});
  await expect(teacher, "/attendance/staff/check-out", "POST", {}, 409);
  await expect(
    parent,
    "/attendance/staff/check-in",
    "POST",
    { staff_id: s.id },
    403,
  );
});
test("all report formats are valid, formulas are escaped and exports are authorized", async () => {
  await expect(admin, `/students/${student}`, "PATCH", {
    first_name: "=FORMULA",
  });
  const csv = await fetch(base + "/reports/students?format=csv", {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /'=FORMULA/);
  const xlsx = await fetch(base + "/reports/students?format=xlsx", {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  assert.equal(wb.worksheets.length, 1);
  assert.equal(wb.worksheets[0].rowCount, 3);
  const pdf = await fetch(base + "/reports/attendance?format=pdf", {
    headers: { Cookie: admin.cookie },
  });
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  await expect(parent, "/reports/students", "GET", undefined, 403);
  await expect(teacher, "/reports/finance", "GET", undefined, 403);
  await expect(admin, `/students/${student}`, "PATCH", { first_name: "Amara" });
});
test("school isolation protects lists, direct objects and relationship writes", async () => {
  const school = await insert(db, "schools", {
    name: "Other School",
    short_code: "OTHER",
  });
  const u = await insert(db, "users", {
    school_id: school.id,
    name: "Other Admin",
    email: "other@test.school",
    password_hash: hashPassword("Test-password-2026!"),
    role: "SUPER_ADMIN",
  });
  const other = await client("other@test.school");
  assert.equal((await expect(other, "/students")).length, 0);
  await expect(other, `/students/${student}`, "GET", undefined, 404);
  await expect(other, `/finance/invoices/${invoice.id}`, "GET", undefined, 404);
  await expect(
    other,
    "/finance/invoices/generate",
    "POST",
    { student_id: student, term_id: term.id, due_date: today },
    404,
  );
  await expect(
    other,
    "/classes",
    "POST",
    {
      name: "Bad reference",
      academic_year_id: term.academic_year_id,
      capacity: 20,
    },
    404,
  );
  await assert.rejects(
    insert(db, "students", {
      school_id: school.id,
      first_name: "Bad",
      last_name: "Reference",
      gender: "OTHER",
      date_of_birth: "2016-01-01",
      guardian_name: "Guardian",
      guardian_phone: "0123",
      class_id: cls.id,
    }),
    (e) => e.code === "23503",
  );
});
test("MFA gate and logout invalidate access; audit records do not contain passwords", async () => {
  const setup = await expect(admin, "/auth/mfa/setup", "POST", {});
  const otp = new OTPAuth.TOTP({
    issuer: "SMPIS",
    label: "admin@test.school",
    secret: OTPAuth.Secret.fromBase32(setup.secret),
  });
  await expect(admin, "/auth/mfa/enable", "POST", { code: otp.generate() });
  const next = await client();
  await expect(next, "/students", "GET", undefined, 403);
  await expect(next, "/auth/mfa/verify", "POST", { code: otp.generate() });
  await expect(next, "/students");
  await expect(next, "/auth/logout", "POST", {});
  await expect(next, "/students", "GET", undefined, 401);
  const logs = await expect(admin, "/audit");
  assert.ok(logs.some((l) => l.action === "ENROLL"));
  assert.ok(logs.some((l) => l.action === "EXPORT"));
  assert.equal(JSON.stringify(logs).includes("Test-password-2026!"), false);
});

test("administrator MFA enrollment is optional and can be enabled", async () => {
  process.env.REQUIRE_MFA = "true";
  const other = await client("other@test.school");
  assert.equal((await expect(other, "/me")).user.mfa_setup_required, false);
  await expect(other, "/users", "GET");
  await expect(other, "/config", "GET");
  const setup = await expect(other, "/auth/mfa/setup", "POST", {}),
    otp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret) });
  await expect(other, "/auth/mfa/enable", "POST", { code: otp.generate() });
  await expect(other, "/users");
  process.env.REQUIRE_MFA = "false";
});
test("public applications expose only classes and create a submitted application", async () => {
  const available = await fetch(base + "/auth/public-admissions/TEST");
  const publicData = (await available.json()).data;
  assert.equal(publicData.school.name, "Test Academy");
  assert.ok(publicData.classes.length);
  assert.equal(JSON.stringify(publicData).includes("guardian"), false);
  const response = await fetch(base + "/auth/public-admissions/TEST", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: "Public",
      last_name: "Applicant",
      gender: "OTHER",
      date_of_birth: "2017-01-01",
      guardian_name: "Guardian",
      guardian_phone: "08010000000",
      applied_class_id: otherClass.id,
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  assert.match((await response.json()).data.reference, /^APP-/);
});
test("scheduled notifications are deduplicated and remain queued without an email provider", async () => {
  delete process.env.SMTP_URL;
  delete process.env.MAIL_FROM;
  await runJobs(db);
  await runJobs(db);
  const count = await one(
    db,
    "SELECT count(*)::int AS n FROM notifications WHERE dedupe_key LIKE 'attendance-alert:%'",
  );
  assert.equal(count.n, 2);
  const pending = await one(
    db,
    "SELECT count(*)::int AS n FROM notifications WHERE delivery_status='PENDING'",
  );
  assert.ok(pending.n >= 3);
});
test("process locks prevent concurrent backup commands", async () => {
  const dir = "test-results/backup-source";
  await mkdir(dir, { recursive: true });
  const release = await acquireDataLock(dir);
  try {
    await assert.rejects(acquireDataLock(dir), /already in use/);
  } finally {
    await release();
  }
});
