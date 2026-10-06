import { one, rows, insert, audit } from "./db.js";
import { fail, localClock, invoiceStatus, token } from "./security.js";

export async function schoolRecord(db, u, table, id) {
  const row = await one(
    db,
    `SELECT * FROM ${table} WHERE school_id=$1 AND id=$2`,
    [u.school_id, id],
  );
  if (!row) fail(404, "Record not found.", "NOT_FOUND");
  return row;
}
export async function classAccess(db, u, id) {
  const c = await schoolRecord(db, u, "classes", id);
  if (u.role === "TEACHER" && c.teacher_user_id !== u.id)
    fail(403, "This class is not assigned to you.", "FORBIDDEN");
  return c;
}
export async function studentAccess(db, u, id) {
  const s = await schoolRecord(db, u, "students", id);
  if (u.role === "PARENT" && s.parent_user_id !== u.id)
    fail(404, "Student not found.");
  if (u.role === "TEACHER") {
    if (!s.class_id) fail(403, "Student is not assigned to your class.");
    await classAccess(db, u, s.class_id);
  }
  return s;
}
export function studentScope(u, alias = "s", start = 2) {
  return u.role === "TEACHER"
    ? {
        sql: ` AND ${alias}.class_id IN (SELECT id FROM classes WHERE teacher_user_id=$${start} AND school_id=$1)`,
        args: [u.id],
      }
    : u.role === "PARENT"
      ? { sql: ` AND ${alias}.parent_user_id=$${start}`, args: [u.id] }
      : { sql: "", args: [] };
}
export async function currentSchool(db, u) {
  return one(db, "SELECT * FROM schools WHERE id=$1", [u.school_id]);
}

export async function generateInvoice(
  db,
  u,
  { student_id, term_id, due_date },
) {
  return db.transaction(async (tx) => {
    const student = await schoolRecord(tx, u, "students", student_id),
      term = await schoolRecord(tx, u, "terms", term_id);
    const existing = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND student_id=$2 AND term_id=$3",
      [u.school_id, student_id, term_id],
    );
    if (existing) return existing;
    const app = await one(
      tx,
      "SELECT * FROM admission_applications WHERE school_id=$1 AND student_id=$2",
      [u.school_id, student_id],
    );
    const classId = student.class_id || app?.applied_class_id;
    if (!classId)
      fail(422, "Assign an application class before generating an invoice.");
    const cls = await schoolRecord(tx, u, "classes", classId);
    if (cls.academic_year_id !== term.academic_year_id)
      fail(422, "The class and term must belong to the same academic year.");
    const fees = await rows(
      tx,
      "SELECT * FROM fee_structures WHERE school_id=$1 AND class_id=$2 AND term_id=$3 ORDER BY id",
      [u.school_id, classId, term_id],
    );
    const items = fees
      .filter(
        (f) =>
          (f.fee_category !== "BOARDING" ||
            student.boarding_status === "BOARDING") &&
          (f.fee_category !== "TRANSPORT" || student.transportation_required),
      )
      .map((f) => ({
        description: f.fee_category,
        amount_cents: Number(f.amount_cents),
      }));
    if (!items.length) fail(422, "Set up fees for this class and term first.");
    let total = items.reduce((sum, item) => sum + item.amount_cents, 0);
    for (const [label, percent] of [
      ["Discount", student.discount_percent],
      ["Scholarship", student.scholarship_percent],
    ]) {
      const reduction = Math.round((total * Number(percent)) / 100);
      if (reduction) {
        items.push({
          description: `${label} (${percent}%)`,
          amount_cents: -reduction,
        });
        total -= reduction;
      }
    }
    const invoice = await one(
      tx,
      "INSERT INTO student_invoices(school_id,student_id,term_id,invoice_number,total_cents,due_date) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(student_id,term_id) DO NOTHING RETURNING *",
      [
        u.school_id,
        student_id,
        term_id,
        `INV-${new Date().getUTCFullYear()}-${token().slice(0, 10).toUpperCase()}`,
        total,
        due_date,
      ],
    );
    if (!invoice)
      return one(
        tx,
        "SELECT * FROM student_invoices WHERE school_id=$1 AND student_id=$2 AND term_id=$3",
        [u.school_id, student_id, term_id],
      );
    for (const item of items)
      await insert(tx, "invoice_items", {
        school_id: u.school_id,
        invoice_id: invoice.id,
        ...item,
      });
    await audit(tx, u, "student_invoices", invoice.id, "CREATE", null, invoice);
    return invoice;
  });
}
export async function recordPayment(db, u, b) {
  return db.transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT * FROM payments WHERE school_id=$1 AND idempotency_key=$2",
      [u.school_id, b.idempotency_key],
    );
    if (existing) {
      if (
        existing.invoice_id !== b.invoice_id ||
        Number(existing.amount_cents) !== b.amount_cents ||
        existing.payment_method !== b.payment_method ||
        existing.reference_number !== b.reference_number
      )
        fail(409, "This payment key was already used for a different payment.");
      return existing;
    }
    const invoice = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [u.school_id, b.invoice_id],
    );
    if (!invoice) fail(404, "Invoice not found.");
    if (
      invoice.waived ||
      b.amount_cents <= 0 ||
      b.amount_cents > Number(invoice.total_cents) - Number(invoice.paid_cents)
    )
      fail(
        422,
        "Payment must be greater than zero and cannot exceed the outstanding balance.",
      );
    const payment = await insert(tx, "payments", {
      school_id: u.school_id,
      ...b,
      receipt_number: `RCT-${token().slice(0, 12).toUpperCase()}`,
      received_by: u.id,
    });
    await tx.query(
      "UPDATE student_invoices SET paid_cents=paid_cents+$1 WHERE school_id=$2 AND id=$3",
      [b.amount_cents, u.school_id, b.invoice_id],
    );
    await audit(tx, u, "payments", payment.id, "CREATE", null, payment);
    return payment;
  });
}
export async function createPaymentPlan(db, u, invoiceId, b) {
  return db.transaction(async (tx) => {
    const invoice = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [u.school_id, invoiceId],
    );
    if (!invoice) fail(404, "Invoice not found.");
    const plans = await one(
      tx,
      "SELECT coalesce(sum(amount_cents),0) AS total FROM payment_plans WHERE school_id=$1 AND invoice_id=$2",
      [u.school_id, invoiceId],
    );
    if (
      b.amount_cents <= 0 ||
      invoice.waived ||
      b.amount_cents + Number(plans.total) >
        Number(invoice.total_cents) - Number(invoice.paid_cents)
    )
      fail(
        422,
        "Planned installments cannot exceed the current outstanding balance.",
      );
    const plan = await insert(tx, "payment_plans", {
      school_id: u.school_id,
      invoice_id: invoiceId,
      ...b,
    });
    await audit(tx, u, "payment_plans", plan.id, "CREATE", null, plan);
    return plan;
  });
}
export const stages = [
  "SUBMITTED",
  "REVIEWED",
  "ASSESSMENT_SCHEDULED",
  "DECISION_PENDING",
  "OFFERED",
  "FEES_PENDING",
  "ENROLLED",
];
export async function advanceApplication(db, u, id, stage, notes) {
  return db.transaction(async (tx) => {
    const app = await one(
      tx,
      "SELECT * FROM admission_applications WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [u.school_id, id],
    );
    if (!app) fail(404, "Application not found.");
    if (["ENROLLED", "REJECTED"].includes(app.stage))
      fail(409, "This application is closed.");
    if (stage === "ENROLLED")
      fail(
        422,
        "Use the enrollment action to complete payment and capacity checks.",
      );
    if (stage === "REJECTED" && !notes.trim())
      fail(422, "Enter a reason for rejecting this application.");
    if (
      stage !== "REJECTED" &&
      stages.indexOf(stage) !== stages.indexOf(app.stage) + 1
    )
      fail(422, "Applications must advance one stage at a time.");
    await tx.query(
      "UPDATE admission_applications SET stage=$1,decision_notes=$2 WHERE id=$3",
      [stage, notes, id],
    );
    await audit(tx, u, "admission_applications", id, "UPDATE", app, {
      stage,
      decision_notes: notes,
    });
    return { id, stage };
  });
}
export async function enroll(db, u, id, termId) {
  return db.transaction(async (tx) => {
    const app = await one(
      tx,
      "SELECT * FROM admission_applications WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [u.school_id, id],
    );
    if (!app) fail(404, "Application not found.");
    if (app.stage !== "FEES_PENDING")
      fail(
        422,
        "Complete the offer and fees-pending stages before enrollment.",
      );
    const cls = await one(
      tx,
      "SELECT * FROM classes WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [u.school_id, app.applied_class_id],
    );
    const term = await schoolRecord(tx, u, "terms", termId);
    if (term.academic_year_id !== cls.academic_year_id)
      fail(422, "Choose a term in the class academic year.");
    const invoice = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND student_id=$2 AND term_id=$3",
      [u.school_id, app.student_id, termId],
    );
    if (
      !invoice ||
      (!invoice.waived &&
        Number(invoice.paid_cents) < Number(invoice.total_cents))
    )
      fail(
        422,
        "Enrollment requires a paid or waived invoice for the selected term.",
      );
    const count = await one(
      tx,
      "SELECT count(*)::int AS n FROM students WHERE school_id=$1 AND class_id=$2 AND status='ENROLLED'",
      [u.school_id, cls.id],
    );
    if (count.n >= cls.capacity)
      fail(422, "The class has reached its capacity.");
    const school = await currentSchool(tx, u),
      student = await schoolRecord(tx, u, "students", app.student_id),
      number =
        student.student_number ||
        `${school.short_code}-${String(student.id).padStart(5, "0")}`;
    await tx.query(
      "UPDATE students SET student_number=$1,class_id=$2,status='ENROLLED',updated_at=now() WHERE id=$3",
      [number, cls.id, student.id],
    );
    await tx.query(
      "UPDATE admission_applications SET stage='ENROLLED' WHERE id=$1",
      [id],
    );
    await insert(tx, "student_enrollment", {
      school_id: u.school_id,
      student_id: student.id,
      class_id: cls.id,
      enrollment_date: localClock(school.timezone).date,
    });
    await audit(tx, u, "students", student.id, "ENROLL", student, {
      student_number: number,
      class_id: cls.id,
      status: "ENROLLED",
    });
    return { student_id: student.id, student_number: number };
  });
}

export async function refreshAlerts(db, schoolId) {
  const school = await one(db, "SELECT * FROM schools WHERE id=$1", [schoolId]);
  if (!school) return;
  const today = localClock(school.timezone).date;
  await db.transaction(async (tx) => {
    const candidates = [];
    const attendance = await rows(
      tx,
      "SELECT s.id,s.first_name,s.last_name,count(*)::int AS n,round(100.0*count(*) FILTER(WHERE a.status IN ('PRESENT','LATE'))/count(*))::int AS rate FROM student_attendance a JOIN students s ON s.id=a.student_id WHERE a.school_id=$1 AND a.attendance_date BETWEEN $2::date-30 AND $2::date AND s.status='ENROLLED' GROUP BY s.id HAVING count(*)>=3",
      [schoolId, today],
    );
    for (const a of attendance)
      if (a.rate < school.attendance_threshold)
        candidates.push({
          category: "ATTENDANCE",
          severity: "HIGH",
          entity_id: a.id,
          message: `${a.first_name} ${a.last_name}: ${a.rate}% attendance over ${a.n} recorded days.`,
        });
    const invoices = await rows(
      tx,
      "SELECT i.*,s.first_name,s.last_name FROM student_invoices i JOIN students s ON s.id=i.student_id WHERE i.school_id=$1 AND i.due_date<$2 AND i.total_cents>i.paid_cents AND NOT i.waived",
      [schoolId, today],
    );
    for (const i of invoices)
      candidates.push({
        category: "FINANCE",
        severity: "MEDIUM",
        entity_id: i.id,
        message: `${i.first_name} ${i.last_name}: invoice ${i.invoice_number} is overdue.`,
      });
    await tx.query(
      "UPDATE alerts SET status='RESOLVED',updated_at=now() WHERE school_id=$1 AND category IN ('ATTENDANCE','FINANCE') AND status<>'RESOLVED' AND NOT ((category='ATTENDANCE' AND entity_id=ANY($2::int[])) OR (category='FINANCE' AND entity_id=ANY($3::int[])))",
      [
        schoolId,
        candidates
          .filter((c) => c.category === "ATTENDANCE")
          .map((c) => c.entity_id),
        candidates
          .filter((c) => c.category === "FINANCE")
          .map((c) => c.entity_id),
      ],
    );
    for (const a of candidates)
      await tx.query(
        "INSERT INTO alerts(school_id,category,severity,entity_id,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,category,entity_id) DO UPDATE SET message=EXCLUDED.message,status=CASE WHEN alerts.status='RESOLVED' THEN 'ACTIVE' ELSE alerts.status END,updated_at=now()",
        [schoolId, a.category, a.severity, a.entity_id, a.message],
      );
  });
}

export async function invoiceList(db, u, termId) {
  const scope = studentScope(u);
  const school = await currentSchool(db, u),
    today = localClock(school.timezone).date;
  const result = await rows(
    db,
    `SELECT i.*,s.first_name,s.last_name,s.student_number,c.name AS class_name FROM student_invoices i JOIN students s ON s.id=i.student_id LEFT JOIN classes c ON c.id=s.class_id WHERE i.school_id=$1${scope.sql}${termId ? ` AND i.term_id=$${scope.args.length + 2}` : ""} ORDER BY i.created_at DESC`,
    [u.school_id, ...scope.args, ...(termId ? [termId] : [])],
  );
  return result.map((i) => ({
    ...i,
    status: invoiceStatus(i, today),
    balance_cents: i.waived ? 0 : Number(i.total_cents) - Number(i.paid_cents),
  }));
}
