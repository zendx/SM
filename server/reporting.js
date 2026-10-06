import express from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { rows, one, audit } from "./db.js";
import {
  permitted,
  fail,
  localClock,
  requirePermission,
  invoiceStatus,
} from "./security.js";
import {
  currentSchool,
  studentScope,
  schoolRecord,
  studentAccess,
  refreshAlerts,
} from "./services.js";
import { id, date } from "./validation.js";
import { refreshOperationAlerts } from './operations-service.js';

export function reportingRoutes(db) {
  const r = express.Router();
  r.get("/dashboard/executive", async (req, res) => {
    if (
      !permitted(req.user, "dashboard.read") &&
      !permitted(req.user, "finance.summary")
    )
      fail(403, "Dashboard is not available for this role.");
    const u = req.user,
      school = await currentSchool(db, u),
      today = localClock(school.timezone).date;
    const term = req.query.term_id
      ? await schoolRecord(db, u, "terms", id.parse(req.query.term_id))
      : await one(db, "SELECT * FROM terms WHERE school_id=$1 AND is_current", [
          u.school_id,
        ]);
    const termId = term?.id || 0,
      start = term?.start_date || today,
      end = term?.end_date || today;
    const enrollment = await one(
      db,
      "SELECT count(*) FILTER(WHERE status='ENROLLED')::int AS enrolled,count(*) FILTER(WHERE status='PROSPECTIVE')::int AS prospective,count(*) FILTER(WHERE status='WITHDRAWN')::int AS withdrawn FROM students WHERE school_id=$1",
      [u.school_id],
    );
    const attendance = await one(
      db,
      "SELECT count(*)::int AS recorded,count(*) FILTER(WHERE status IN ('PRESENT','LATE'))::int AS present,count(*) FILTER(WHERE status='ABSENT')::int AS absent FROM student_attendance WHERE school_id=$1 AND attendance_date=$2",
      [u.school_id, today],
    );
    const finance = permitted(u, "finance.summary")
      ? await one(
          db,
          "SELECT coalesce(sum(total_cents) FILTER(WHERE NOT waived),0) AS billed,coalesce(sum(paid_cents),0) AS collected,coalesce(sum(total_cents-paid_cents) FILTER(WHERE NOT waived),0) AS outstanding,count(*) FILTER(WHERE due_date<$3 AND total_cents>paid_cents AND NOT waived)::int AS overdue FROM student_invoices WHERE school_id=$1 AND term_id=$2",
          [u.school_id, termId, today],
        )
      : null;
    const staff = await one(
      db,
      "SELECT count(*)::int AS total FROM staff WHERE school_id=$1 AND status='ACTIVE'",
      [u.school_id],
    );
    const staffToday = await one(
      db,
      "SELECT count(*) FILTER(WHERE status IN ('PRESENT','LATE'))::int AS present,count(*) FILTER(WHERE status='LATE')::int AS late FROM staff_attendance WHERE school_id=$1 AND attendance_date=$2",
      [u.school_id, today],
    );
    const classCounts = await rows(
      db,
      "SELECT c.name,count(s.id)::int AS count,c.capacity FROM classes c LEFT JOIN students s ON s.class_id=c.id AND s.status='ENROLLED' WHERE c.school_id=$1 AND c.academic_year_id=$2 GROUP BY c.id ORDER BY c.name",
      [u.school_id, term?.academic_year_id || 0],
    );
    const attendanceTrend = await rows(
      db,
      "SELECT attendance_date AS date,round(100.0*count(*) FILTER(WHERE status IN ('PRESENT','LATE'))/count(*),1) AS value FROM student_attendance WHERE school_id=$1 AND attendance_date BETWEEN $2 AND $3 GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 14",
      [u.school_id, start, end],
    );
    const collectionTrend = finance
      ? await rows(
          db,
          "SELECT to_char(p.paid_at AT TIME ZONE $4,'YYYY-MM-DD') AS date,sum(p.amount_cents) AS value FROM payments p JOIN student_invoices i ON i.id=p.invoice_id WHERE p.school_id=$1 AND i.term_id=$2 AND (p.paid_at AT TIME ZONE $4)::date<=$3 GROUP BY 1 ORDER BY 1 DESC LIMIT 14",
          [u.school_id, termId, today, school.timezone],
        )
      : [];
    await refreshAlerts(db, u.school_id);
    const alertSummary = await rows(
      db,
      "SELECT category,count(*)::int AS count FROM alerts WHERE school_id=$1 AND status='ACTIVE' GROUP BY category",
      [u.school_id],
    );
    res.json({
      data: {
        enrollment,
        attendance,
        finance,
        staff: { ...staff, ...staffToday },
        classCounts,
        attendanceTrend: attendanceTrend.reverse(),
        collectionTrend: collectionTrend.reverse(),
        alertSummary,
        today,
        term,
      },
    });
  });
  r.get("/alerts", async (req, res) => {
    await refreshOperationAlerts(db, req.user.school_id);
    const cats = [];
    if (permitted(req.user, "attendance.read") && req.user.role !== "TEACHER")
      cats.push("ATTENDANCE");
    if (permitted(req.user, "finance.read")) cats.push("FINANCE");
    if (permitted(req.user, "discipline.manage")) cats.push("DISCIPLINE");
    if (permitted(req.user, "complaints.manage")) cats.push("PARENT");
    if (permitted(req.user, "facilities.manage")) cats.push("FACILITIES");
    if (permitted(req.user, "academics.manage")) cats.push("ACADEMIC");
    if (permitted(req.user, "curriculum.manage")) cats.push("CURRICULUM");
    res.json({
      data: await rows(
        db,
        "SELECT * FROM alerts WHERE school_id=$1 AND category=ANY($2::text[]) AND status<>'RESOLVED' ORDER BY CASE severity WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,updated_at DESC",
        [req.user.school_id, cats],
      ),
    });
  });
  r.patch("/alerts/:id/acknowledge", async (req, res) => {
    const alert = await schoolRecord(
      db,
      req.user,
      "alerts",
      id.parse(req.params.id),
    );
    if (
      ([
        "DISCIPLINE",
        "PARENT",
        "FACILITIES",
        "ACADEMIC",
        "CURRICULUM",
      ].includes(alert.category) &&
        !permitted(
          req.user,
          {
            DISCIPLINE: "discipline.manage",
            PARENT: "complaints.manage",
            FACILITIES: "facilities.manage",
            ACADEMIC: "academics.manage",
            CURRICULUM: "curriculum.manage",
          }[alert.category],
        )) ||
      (alert.category === "FINANCE" && !permitted(req.user, "finance.read")) ||
      (alert.category === "ATTENDANCE" &&
        (!permitted(req.user, "attendance.read") ||
          req.user.role === "TEACHER"))
    )
      fail(403, "This alert is not available to your role.");
    await db.query("UPDATE alerts SET status='ACKNOWLEDGED' WHERE id=$1", [
      alert.id,
    ]);
    await audit(db, req.user, "alerts", alert.id, "ACKNOWLEDGE");
    res.json({ data: { ok: true } });
  });
  r.get("/reports/:key", async (req, res) => {
    const key = req.params.key,
      format = String(req.query.format || "csv"),
      permission = {
        students: "reports.students",
        attendance: "reports.attendance",
        finance: "reports.finance",
        staff: "reports.staff",
        "attendance-summary": "reports.attendance",
        "chronic-absence": "reports.attendance",
        discipline: "discipline.manage",
        complaints: "complaints.manage",
        maintenance: "facilities.manage",
        "staff-performance": "hr.manage",
      }[key];
    if (!permission || !permitted(req.user, permission))
      fail(403, "This report is not available to your role.");
    if (!["csv", "xlsx", "pdf"].includes(format))
      fail(422, "Choose PDF, Excel or CSV.");
    const school = await currentSchool(db, req.user),
      today = localClock(school.timezone).date,
      from = req.query.from
        ? date.parse(req.query.from)
        : `${today.slice(0, 4)}-01-01`,
      to = req.query.to ? date.parse(req.query.to) : today;
    if (from > to) fail(422, "The report start must precede its end.");
    const scope = studentScope(req.user);
    if (req.query.class_id) {
      const cid = id.parse(req.query.class_id);
      await schoolRecord(db, req.user, "classes", cid);
      scope.args.push(cid);
      scope.sql += ` AND s.class_id=$${scope.args.length + 1}`;
    }
    let data;
    if (["attendance-summary", "chronic-absence"].includes(key))
      data = await rows(
        db,
        `SELECT s.student_number,s.first_name,s.last_name,c.name AS class,count(*)::int AS recorded_days,count(*) FILTER(WHERE a.status IN ('PRESENT','LATE'))::int AS attended_days,count(*) FILTER(WHERE a.status='ABSENT')::int AS absent_days,round(100.0*count(*) FILTER(WHERE a.status IN ('PRESENT','LATE'))/count(*),2) AS attendance_percent FROM student_attendance a JOIN students s ON s.id=a.student_id LEFT JOIN classes c ON c.id=s.class_id WHERE a.school_id=$1${scope.sql} AND a.attendance_date BETWEEN $${scope.args.length + 2} AND $${scope.args.length + 3} GROUP BY s.id,c.name${key === "chronic-absence" ? ` HAVING count(*)>=3 AND 100.0*count(*) FILTER(WHERE a.status IN ('PRESENT','LATE'))/count(*)<${Number(school.attendance_threshold)}` : ""} ORDER BY s.last_name`,
        [req.user.school_id, ...scope.args, from, to],
      );
    if (["discipline", "complaints", "maintenance"].includes(key))
      data = await rows(
        db,
        "SELECT c.id AS case_reference,c.category,c.event_date,c.priority,c.stage,coalesce(s.first_name||' '||s.last_name,f.name,'') AS subject,u.name AS assigned_to,c.cost_cents,c.created_at,c.resolved_at FROM service_cases c LEFT JOIN students s ON s.id=c.student_id LEFT JOIN facilities f ON f.id=c.facility_id LEFT JOIN users u ON u.id=c.assigned_to WHERE c.school_id=$1 AND c.kind=$2 AND c.event_date BETWEEN $3 AND $4 ORDER BY c.event_date DESC",
        [
          req.user.school_id,
          {
            discipline: "DISCIPLINE",
            complaints: "COMPLAINT",
            maintenance: "MAINTENANCE",
          }[key],
          from,
          to,
        ],
      );
    if (key === "staff-performance")
      data = await rows(
        db,
        "SELECT s.staff_number,s.first_name,s.last_name,s.department,y.name AS academic_year,r.overall_score,r.development_score,r.created_at FROM performance_reviews r JOIN staff s ON s.id=r.staff_id JOIN academic_years y ON y.id=r.academic_year_id WHERE r.school_id=$1 AND r.created_at::date BETWEEN $2 AND $3 ORDER BY r.created_at DESC",
        [req.user.school_id, from, to],
      );
    if (key === "students")
      data = await rows(
        db,
        `SELECT s.student_number,s.first_name,s.last_name,s.gender,s.status,c.name AS class FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.school_id=$1${scope.sql} ORDER BY s.last_name`,
        [req.user.school_id, ...scope.args],
      );
    if (key === "attendance")
      data = await rows(
        db,
        `SELECT a.attendance_date,s.student_number,s.first_name,s.last_name,c.name AS class,a.status,a.remarks FROM student_attendance a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.school_id=$1${scope.sql} AND a.attendance_date BETWEEN $${scope.args.length + 2} AND $${scope.args.length + 3} ORDER BY a.attendance_date DESC,s.last_name`,
        [req.user.school_id, ...scope.args, from, to],
      );
    if (key === "finance")
      data = (
        await rows(
          db,
          "SELECT i.invoice_number,s.first_name,s.last_name,i.total_cents,i.paid_cents,i.due_date,i.waived FROM student_invoices i JOIN students s ON s.id=i.student_id WHERE i.school_id=$1 AND i.due_date BETWEEN $2 AND $3 ORDER BY i.due_date",
          [req.user.school_id, from, to],
        )
      ).map((i) => ({
        invoice: i.invoice_number,
        student: `${i.first_name} ${i.last_name}`,
        billed: (Number(i.total_cents) / 100).toFixed(2),
        paid: (Number(i.paid_cents) / 100).toFixed(2),
        outstanding: (i.waived
          ? 0
          : (Number(i.total_cents) - Number(i.paid_cents)) / 100
        ).toFixed(2),
        currency: school.currency_code,
        status: invoiceStatus(i, today),
        due_date: i.due_date,
      }));
    if (key === "staff")
      data = await rows(
        db,
        "SELECT a.attendance_date,s.staff_number,s.first_name,s.last_name,s.department,a.status,a.check_in_time,a.check_out_time,round(extract(epoch FROM(a.check_out_time-a.check_in_time))/3600,2) AS hours FROM staff_attendance a JOIN staff s ON s.id=a.staff_id WHERE a.school_id=$1 AND a.attendance_date BETWEEN $2 AND $3 ORDER BY a.attendance_date DESC",
        [req.user.school_id, from, to],
      );
    await audit(db, req.user, "reports", 0, "EXPORT", null, {
      key,
      format,
      from,
      to,
      rows: data.length,
    });
    const cols = data.length ? Object.keys(data[0]) : ["message"];
    if (!data.length)
      data = [{ message: "No records for the selected period." }];
    const string = (v) =>
      v instanceof Date ? v.toISOString() : String(v ?? "");
    res.attachment(`smpis-${key}-${today}.${format}`);
    if (format === "csv") {
      const cell = (v) =>
        `"${string(v)
          .replace(/^[=+\-@\t\r]/, "'$&")
          .replaceAll('"', '""')}"`;
      res
        .type("text/csv")
        .send(
          "\ufeff" +
            [cols, ...data.map((row) => cols.map((c) => row[c]))]
              .map((row) => row.map(cell).join(","))
              .join("\r\n"),
        );
    }
    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(key);
      ws.columns = cols.map((c) => ({
        header: c.replaceAll("_", " "),
        key: c,
        width: 24,
      }));
      data.forEach((row) =>
        ws.addRow(Object.fromEntries(cols.map((c) => [c, string(row[c])]))),
      );
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      res.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      await wb.xlsx.write(res);
      res.end();
    }
    if (format === "pdf") {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 30,
      });
      res.type("application/pdf");
      doc.pipe(res);
      doc
        .fontSize(18)
        .text(school.name)
        .fontSize(12)
        .text(`${key.toUpperCase()} REPORT | ${from} to ${to}`)
        .moveDown();
      const width = 780 / cols.length;
      function header() {
        const y = doc.y;
        cols.forEach((c, i) =>
          doc
            .font("Helvetica-Bold")
            .fontSize(8)
            .text(c.replaceAll("_", " "), 30 + i * width, y, {
              width: width - 5,
              height: 25,
            }),
        );
        doc.y = y + 30;
      }
      header();
      for (const row of data) {
        if (doc.y > 530) {
          doc.addPage();
          header();
        }
        const y = doc.y;
        cols.forEach((c, i) =>
          doc
            .font("Helvetica")
            .fontSize(8)
            .text(string(row[c]), 30 + i * width, y, {
              width: width - 5,
              height: 40,
              ellipsis: true,
            }),
        );
        doc.y = y + 45;
      }
      doc.end();
    }
  });
  r.get("/finance/payments/:id/receipt", async (req, res) => {
    if (
      !permitted(req.user, "finance.read") &&
      !permitted(req.user, "finance.own")
    )
      fail(403, "Receipts are not available for this role.");
    const p = await schoolRecord(
        db,
        req.user,
        "payments",
        id.parse(req.params.id),
      ),
      i = await schoolRecord(db, req.user, "student_invoices", p.invoice_id),
      s = await studentAccess(db, req.user, i.student_id),
      school = await currentSchool(db, req.user);
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    res.attachment(`${p.receipt_number}.pdf`).type("application/pdf");
    doc.pipe(res);
    doc
      .fontSize(24)
      .text(school.name)
      .moveDown()
      .fontSize(18)
      .text("PAYMENT RECEIPT")
      .moveDown()
      .fontSize(12);
    for (const [k, v] of Object.entries({
      Receipt: p.receipt_number,
      Invoice: i.invoice_number,
      Student: `${s.first_name} ${s.last_name}`,
      Amount: `${school.currency_code} ${(Number(p.amount_cents) / 100).toFixed(2)}`,
      Method: p.payment_method,
      Reference: p.reference_number || "—",
      Date: new Date(p.paid_at).toLocaleString("en-GB", {
        timeZone: school.timezone,
      }),
    }))
      doc.text(`${k}: ${v}`).moveDown(0.5);
    doc.moveDown().text("Thank you. Keep this receipt for your records.");
    doc.end();
  });
  return r;
}
