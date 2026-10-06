import { smtpConfig } from "./integrations.js";
import express from "express";
import multer from "multer";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_MB } from "./document-limits.js";
import {
  preserveBeforeTransfer,
  rosterAfterTransfer,
} from "./history-service.js";
import path from "node:path";
import { one, rows, insert, audit } from "./db.js";
import {
  fail,
  requirePermission,
  permitted,
  localClock,
  cents,
  token,
  ROLE_PERMISSIONS,
} from "./security.js";
import {
  z,
  text,
  optionalText,
  id,
  date,
  studentSchema,
  attendanceStatuses,
} from "./validation.js";
import {
  schoolRecord,
  currentSchool,
  classAccess,
  studentAccess,
  studentScope,
  generateInvoice,
  recordPayment,
  createPaymentPlan,
  advanceApplication,
  enroll,
  refreshAlerts,
  invoiceList,
} from "./services.js";

export function coreRoutes(db, { dataDir = "./data", documentStorage } = {}) {
  const r = express.Router(),
    allow =
      (...permissions) =>
      (req, res, next) => {
        if (!permissions.some((p) => permitted(req.user, p)))
          fail(403, "Your role cannot access these records.", "FORBIDDEN");
        next();
      };
  const ok = (res, data) => res.json({ data, errors: [] });
  r.get("/config", async (req, res) => {
    const school = await currentSchool(db, req.user),
      years = await rows(
        db,
        "SELECT * FROM academic_years WHERE school_id=$1 ORDER BY start_date DESC",
        [req.user.school_id],
      ),
      terms = await rows(
        db,
        "SELECT * FROM terms WHERE school_id=$1 ORDER BY start_date DESC",
        [req.user.school_id],
      );
    ok(res, {
      school,
      years,
      terms,
      today: localClock(school.timezone).date,
      roles: Object.keys(ROLE_PERMISSIONS),
      role_permissions: permitted(req.user, "admin.write")
        ? ROLE_PERMISSIONS
        : undefined,
      smtp_configured: !!(await smtpConfig(db, req.user.school_id)),
    });
  });
  r.patch("/config", requirePermission("admin.write"), async (req, res) => {
    const b = z
      .object({
        name: text,
        currency_code: z.string().regex(/^[A-Z]{3}$/),
        timezone: text,
        attendance_threshold: z.coerce.number().int().min(1).max(100),
        staff_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        attendance_cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone });
    } catch {
      fail(422, "Invalid timezone.");
    }
    await db.transaction(async (tx) => {
      const before = await currentSchool(tx, req.user);
      if (
        before.currency_code !== b.currency_code &&
        (await one(
          tx,
          "SELECT id FROM student_invoices WHERE school_id=$1 LIMIT 1",
          [req.user.school_id],
        ))
      )
        fail(422, "Currency cannot change after invoicing begins.");
      await tx.query(
        "UPDATE schools SET name=$1,currency_code=$2,timezone=$3,attendance_threshold=$4,staff_start=$5,attendance_cutoff=$6 WHERE id=$7",
        [
          b.name,
          b.currency_code,
          b.timezone,
          b.attendance_threshold,
          b.staff_start,
          b.attendance_cutoff,
          req.user.school_id,
        ],
      );
      await audit(
        tx,
        req.user,
        "schools",
        req.user.school_id,
        "UPDATE",
        before,
        b,
      );
    });
    ok(res, b);
  });
  r.post(
    "/academic-years",
    requirePermission("admin.write"),
    async (req, res) => {
      const b = z
        .object({ name: text, start_date: date, end_date: date })
        .parse(req.body);
      if (b.end_date <= b.start_date)
        fail(422, "End date must follow start date.");
      ok(
        res,
        await insert(db, "academic_years", {
          school_id: req.user.school_id,
          ...b,
        }),
      );
    },
  );
  r.post("/terms", requirePermission("admin.write"), async (req, res) => {
    const b = z
      .object({
        name: text,
        academic_year_id: id,
        start_date: date,
        end_date: date,
        is_current: z.boolean().default(false),
      })
      .parse(req.body);
    ok(
      res,
      await db.transaction(async (tx) => {
        const year = await schoolRecord(
          tx,
          req.user,
          "academic_years",
          b.academic_year_id,
        );
        if (
          b.start_date < year.start_date ||
          b.end_date > year.end_date ||
          b.start_date > b.end_date
        )
          fail(422, "Term dates must lie within the academic year.");
        if (b.is_current)
          await tx.query(
            "UPDATE terms SET is_current=false WHERE school_id=$1",
            [req.user.school_id],
          );
        return insert(tx, "terms", { school_id: req.user.school_id, ...b });
      }),
    );
  });
  r.get(
    "/classes",
    allow(
      "students.read",
      "attendance.read",
      "finance.read",
      "admin.write",
      "classes.write",
    ),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          `SELECT c.*,u.name AS teacher_name,(SELECT count(*)::int FROM students s WHERE s.class_id=c.id AND s.status='ENROLLED') AS enrolled FROM classes c LEFT JOIN users u ON u.id=c.teacher_user_id WHERE c.school_id=$1${req.user.role === "TEACHER" ? " AND c.teacher_user_id=$2" : ""} ORDER BY c.name`,
          req.user.role === "TEACHER"
            ? [req.user.school_id, req.user.id]
            : [req.user.school_id],
        ),
      ),
  );
  r.post(
    "/classes",
    allow("admin.write", "classes.write"),
    async (req, res) => {
      const b = z
        .object({
          name: text,
          academic_year_id: id,
          capacity: z.coerce.number().int().min(1).max(500),
          teacher_user_id: id.nullable().default(null),
        })
        .parse(req.body);
      await schoolRecord(db, req.user, "academic_years", b.academic_year_id);
      if (b.teacher_user_id) {
        const teacher = await schoolRecord(
          db,
          req.user,
          "users",
          b.teacher_user_id,
        );
        if (teacher.role !== "TEACHER")
          fail(422, "Class teacher must have the Teacher role.");
      }
      const c = await insert(db, "classes", {
        school_id: req.user.school_id,
        ...b,
      });
      await audit(db, req.user, "classes", c.id, "CREATE", null, c);
      ok(res, c);
    },
  );
  r.get(
    "/students",
    allow("students.read", "children.read"),
    async (req, res) => {
      const scope = studentScope(req.user),
        args = [req.user.school_id, ...scope.args];
      let where = scope.sql;
      if (req.query.search) {
        args.push(`%${String(req.query.search).slice(0, 100)}%`);
        where += ` AND (s.first_name||' '||s.last_name||' '||coalesce(s.student_number,'')) ILIKE $${args.length}`;
      }
      if (req.query.class_id) {
        args.push(id.parse(req.query.class_id));
        where += ` AND s.class_id=$${args.length}`;
      }
      if (req.query.status) {
        args.push(String(req.query.status));
        where += ` AND s.status=$${args.length}`;
      }
      const page = z.coerce
          .number()
          .int()
          .min(1)
          .default(1)
          .parse(req.query.page),
        per = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .parse(req.query.per_page);
      const total = await one(
        db,
        `SELECT count(*)::int AS n FROM students s WHERE s.school_id=$1${where}`,
        args,
      );
      const data = await rows(
        db,
        `SELECT s.id,s.first_name,s.last_name,s.student_number,s.gender,s.status,s.boarding_status,s.class_id,c.name AS class_name,s.guardian_name,s.guardian_phone FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.school_id=$1${where} ORDER BY s.last_name,s.first_name LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, per, (page - 1) * per],
      );
      res.json({
        data,
        meta: { page, per_page: per, total: total.n },
        errors: [],
      });
    },
  );
  r.get(
    "/students/:id",
    allow("students.read", "children.read"),
    async (req, res) => {
      const s = await studentAccess(db, req.user, id.parse(req.params.id));
      if (req.user.role === "TEACHER") {
        delete s.medical_info;
        delete s.guardian_email;
        delete s.address;
        delete s.discount_percent;
        delete s.scholarship_percent;
        delete s.parent_user_id;
      }
      const documents =
        req.user.role === "TEACHER"
          ? []
          : await rows(
              db,
              "SELECT id,name,mime,size,created_at FROM student_documents WHERE school_id=$1 AND student_id=$2 ORDER BY id DESC",
              [req.user.school_id, s.id],
            );
      ok(res, {
        ...s,
        documents,
        attendance: await rows(
          db,
          "SELECT attendance_date,status,remarks FROM student_attendance WHERE school_id=$1 AND student_id=$2 ORDER BY attendance_date DESC LIMIT 60",
          [req.user.school_id, s.id],
        ),
      });
    },
  );
  r.patch(
    "/students/:id",
    allow("students.write", "children.write"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        s = await studentAccess(db, req.user, sid);
      const shape = { address: optionalText, guardian_phone: text };
      if (req.user.role !== "PARENT")
        Object.assign(shape, {
          first_name: text,
          last_name: text,
          guardian_name: text,
          guardian_email: z.union([z.email(), z.literal("")]),
          medical_info: optionalText,
          special_requirements: optionalText,
          parent_user_id: id.nullable(),
          boarding_status: z.enum(["DAY", "BOARDING"]),
          transportation_required: z.boolean(),
        });
      const b = z.object(shape).partial().strict().parse(req.body);
      if (!Object.keys(b).length) fail(422, "No editable fields supplied.");
      if (b.parent_user_id) {
        const p = await schoolRecord(db, req.user, "users", b.parent_user_id);
        if (p.role !== "PARENT")
          fail(422, "Linked account must have the Parent role.");
      }
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE students SET ${Object.keys(b)
            .map((k, i) => `${k}=$${i + 1}`)
            .join(
              ",",
            )},updated_at=now() WHERE id=$${Object.keys(b).length + 1}`,
          [...Object.values(b), sid],
        );
        await audit(tx, req.user, "students", sid, "UPDATE", s, b);
      });
      ok(res, { id: sid });
    },
  );
  r.post(
    "/students/:id/enrollment",
    requirePermission("students.write"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        b = z.object({ class_id: id }).parse(req.body);
      await db.transaction(async (tx) => {
        const s = await studentAccess(tx, req.user, sid);
        if (s.status !== "ENROLLED")
          fail(422, "Use admissions to enroll a new student.");
        const cls = await one(
          tx,
          "SELECT * FROM classes WHERE school_id=$1 AND id=$2",
          [req.user.school_id, b.class_id],
        );
        if (!cls) fail(404, "Class not found.");
        if (s.class_id === cls.id) return;
        await tx.query(
          "SELECT id FROM classes WHERE school_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE",
          [req.user.school_id, [s.class_id, cls.id].filter(Boolean)],
        );
        await preserveBeforeTransfer(tx, req.user, s);
        const count = await one(
          tx,
          "SELECT count(*)::int AS n FROM students WHERE class_id=$1 AND status='ENROLLED'",
          [cls.id],
        );
        if (count.n >= cls.capacity)
          fail(422, "The class has reached its capacity.");
        await tx.query(
          "UPDATE student_enrollment SET status='TRANSFERRED' WHERE student_id=$1 AND status='ACTIVE'",
          [sid],
        );
        await tx.query(
          "UPDATE students SET class_id=$1,updated_at=now() WHERE id=$2",
          [cls.id, sid],
        );
        await insert(tx, "student_enrollment", {
          school_id: req.user.school_id,
          student_id: sid,
          class_id: cls.id,
          enrollment_date: localClock(
            (await currentSchool(tx, req.user)).timezone,
          ).date,
        });
        await rosterAfterTransfer(tx, req.user, s, cls.id);
        await audit(
          tx,
          req.user,
          "students",
          sid,
          "TRANSFER",
          { class_id: s.class_id },
          b,
        );
      });
      ok(res, { ok: true });
    },
  );
  r.get(
    "/admissions/applications",
    requirePermission("admissions.write"),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          "SELECT a.*,s.first_name,s.last_name,s.guardian_name,c.name AS class_name FROM admission_applications a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.applied_class_id WHERE a.school_id=$1 ORDER BY a.created_at DESC",
          [req.user.school_id],
        ),
      ),
  );
  r.post(
    "/admissions/applications",
    requirePermission("admissions.write"),
    async (req, res) => {
      const b = studentSchema.parse(req.body);
      await schoolRecord(db, req.user, "classes", b.applied_class_id);
      const result = await db.transaction(async (tx) => {
        const { applied_class_id, previous_school, ...fields } = b;
        const student = await insert(tx, "students", {
          school_id: req.user.school_id,
          ...fields,
        });
        const app = await insert(tx, "admission_applications", {
          school_id: req.user.school_id,
          student_id: student.id,
          applied_class_id,
          previous_school,
        });
        await audit(
          tx,
          req.user,
          "students",
          student.id,
          "CREATE",
          null,
          student,
        );
        await audit(
          tx,
          req.user,
          "admission_applications",
          app.id,
          "CREATE",
          null,
          app,
        );
        return app;
      });
      res.status(201).json({ data: result });
    },
  );
  r.patch(
    "/admissions/applications/:id/stage",
    requirePermission("admissions.write"),
    async (req, res) => {
      const b = z
        .object({
          stage: z.enum([
            "REVIEWED",
            "ASSESSMENT_SCHEDULED",
            "DECISION_PENDING",
            "OFFERED",
            "FEES_PENDING",
            "REJECTED",
          ]),
          notes: optionalText,
        })
        .parse(req.body);
      ok(
        res,
        await advanceApplication(
          db,
          req.user,
          id.parse(req.params.id),
          b.stage,
          b.notes,
        ),
      );
    },
  );
  r.post(
    "/admissions/applications/:id/enroll",
    requirePermission("admissions.write"),
    async (req, res) =>
      ok(
        res,
        await enroll(
          db,
          req.user,
          id.parse(req.params.id),
          id.parse(req.body.term_id),
        ),
      ),
  );

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 },
  });
  r.post(
    "/students/:id/documents",
    allow("students.write", "children.write"),
    upload.single("document"),
    async (req, res) => {
      const s = await studentAccess(db, req.user, id.parse(req.params.id)),
        f = req.file;
      if (!f)
        fail(
          422,
          `Choose a PDF, PNG or JPEG file (up to ${DOCUMENT_MAX_MB} MB).`,
        );
      const sig = f.buffer.subarray(0, 8),
        mime =
          sig.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : sig.toString("hex") === "89504e470d0a1a0a"
              ? "image/png"
              : sig.subarray(0, 3).toString("hex") === "ffd8ff"
                ? "image/jpeg"
                : null;
      if (!mime) fail(422, "Only PDF, PNG and JPEG documents are supported.");
      const key = token();
      await documentStorage.put(key, f.buffer, mime);
      const doc = await insert(db, "student_documents", {
        school_id: req.user.school_id,
        student_id: s.id,
        name: path
          .basename(f.originalname)
          .replace(/[\r\n]/g, "")
          .slice(0, 200),
        storage_key: key,
        mime,
        size: f.size,
        uploaded_by: req.user.id,
      });
      await audit(db, req.user, "student_documents", doc.id, "CREATE", null, {
        name: doc.name,
        student_id: s.id,
      });
      ok(res, { id: doc.id });
    },
  );
  r.get(
    "/documents/:id",
    allow("students.write", "children.read", "admissions.write"),
    async (req, res) => {
      const d = await schoolRecord(
        db,
        req.user,
        "student_documents",
        id.parse(req.params.id),
      );
      await studentAccess(db, req.user, d.student_id);
      res
        .type(d.mime)
        .attachment(d.name)
        .send(await documentStorage.get(d.storage_key));
    },
  );

  r.get(
    "/attendance/students",
    allow("attendance.read", "attendance.own"),
    async (req, res) => {
      if (req.query.student_id) {
        const s = await studentAccess(
          db,
          req.user,
          id.parse(req.query.student_id),
        );
        return ok(
          res,
          await rows(
            db,
            "SELECT attendance_date,status,remarks FROM student_attendance WHERE school_id=$1 AND student_id=$2 ORDER BY attendance_date DESC",
            [req.user.school_id, s.id],
          ),
        );
      }
      if (req.user.role === "PARENT") fail(422, "Select one of your children.");
      const cid = id.parse(req.query.class_id),
        day = date.parse(req.query.date);
      await classAccess(db, req.user, cid);
      ok(
        res,
        await rows(
          db,
          "SELECT s.id,s.student_number,s.first_name,s.last_name,a.status,a.remarks FROM students s LEFT JOIN student_attendance a ON a.student_id=s.id AND a.attendance_date=$3 WHERE s.school_id=$1 AND s.class_id=$2 AND s.status='ENROLLED' ORDER BY s.last_name",
          [req.user.school_id, cid, day],
        ),
      );
    },
  );
  r.post(
    "/attendance/students",
    requirePermission("attendance.write"),
    async (req, res) => {
      const b = z
        .object({
          class_id: id,
          date,
          records: z
            .array(
              z.object({
                student_id: id,
                status: z.enum(attendanceStatuses),
                remarks: optionalText,
              }),
            )
            .min(1)
            .max(500),
        })
        .parse(req.body);
      const school = await currentSchool(db, req.user),
        clock = localClock(school.timezone);
      await classAccess(db, req.user, b.class_id);
      if (b.date > clock.date)
        fail(422, "Attendance cannot be recorded in the future.");
      if (
        (b.date < clock.date || clock.time > school.attendance_cutoff) &&
        !(await one(
          db,
          "SELECT * FROM attendance_unlocks WHERE school_id=$1 AND class_id=$2 AND attendance_date=$3",
          [req.user.school_id, b.class_id, b.date],
        ))
      )
        fail(
          423,
          "Attendance is locked. Ask an administrator to unlock this class and date.",
        );
      if (new Set(b.records.map((x) => x.student_id)).size !== b.records.length)
        fail(422, "Duplicate students in attendance submission.");
      await db.transaction(async (tx) => {
        for (const a of b.records) {
          const s = await schoolRecord(tx, req.user, "students", a.student_id);
          if (s.class_id !== b.class_id || s.status !== "ENROLLED")
            fail(422, "Every student must be enrolled in the selected class.");
          const before = await one(
            tx,
            "SELECT * FROM student_attendance WHERE student_id=$1 AND attendance_date=$2",
            [s.id, b.date],
          );
          const record = await one(
            tx,
            "INSERT INTO student_attendance(school_id,student_id,class_id,attendance_date,status,recorded_by,remarks) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(student_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,remarks=EXCLUDED.remarks,recorded_by=EXCLUDED.recorded_by,updated_at=now() RETURNING *",
            [
              req.user.school_id,
              s.id,
              b.class_id,
              b.date,
              a.status,
              req.user.id,
              a.remarks,
            ],
          );
          await audit(
            tx,
            req.user,
            "student_attendance",
            record.id,
            before ? "UPDATE" : "CREATE",
            before,
            record,
          );
          if (a.status === "ABSENT")
            await tx.query(
              "INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,dedupe_key) DO NOTHING",
              [
                req.user.school_id,
                s.parent_user_id,
                s.guardian_email,
                `Absence recorded: ${s.first_name}`,
                `${s.first_name} ${s.last_name} was marked absent on ${b.date}. Please contact the school if this is incorrect.`,
                `absence:${s.id}:${b.date}`,
              ],
            );
        }
      });
      await refreshAlerts(db, req.user.school_id);
      ok(res, { saved: b.records.length });
    },
  );
  r.post(
    "/attendance/unlock",
    requirePermission("admin.write"),
    async (req, res) => {
      const b = z.object({ class_id: id, date }).parse(req.body);
      await classAccess(db, req.user, b.class_id);
      await db.query(
        "INSERT INTO attendance_unlocks(school_id,class_id,attendance_date) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [req.user.school_id, b.class_id, b.date],
      );
      await audit(
        db,
        req.user,
        "classes",
        b.class_id,
        "UNLOCK_ATTENDANCE",
        null,
        b,
      );
      ok(res, { ok: true });
    },
  );

  r.get(
    "/hr/staff",
    allow("staff.read", "staff.attendance.read", "staff.self"),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          `SELECT s.*,u.email FROM staff s LEFT JOIN users u ON u.id=s.user_id WHERE s.school_id=$1${permitted(req.user, "staff.read") || permitted(req.user, "staff.attendance.read") ? "" : " AND s.user_id=$2"} ORDER BY s.last_name`,
          permitted(req.user, "staff.read") ||
            permitted(req.user, "staff.attendance.read")
            ? [req.user.school_id]
            : [req.user.school_id, req.user.id],
        ),
      ),
  );
  r.post("/hr/staff", requirePermission("staff.write"), async (req, res) => {
    const b = z
      .object({
        first_name: text,
        last_name: text,
        department: text,
        position: text,
        hire_date: date,
        employment_type: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]),
        user_id: id.nullable().default(null),
      })
      .parse(req.body);
    if (b.user_id) {
      const u = await schoolRecord(db, req.user, "users", b.user_id);
      if (["PARENT", "STUDENT", "PROPRIETOR"].includes(u.role))
        fail(422, "Choose a staff user account.");
    }
    const s = await insert(db, "staff", {
      school_id: req.user.school_id,
      staff_number: `STF-${token().slice(0, 8).toUpperCase()}`,
      ...b,
    });
    await audit(db, req.user, "staff", s.id, "CREATE", null, s);
    ok(res, s);
  });
  r.get(
    "/attendance/staff",
    allow("staff.attendance.read", "staff.self"),
    async (req, res) => {
      let args = [req.user.school_id];
      let scope = "";
      if (!permitted(req.user, "staff.attendance.read")) {
        args.push(req.user.id);
        scope = " AND s.user_id=$2";
      }
      ok(
        res,
        await rows(
          db,
          `SELECT a.*,s.first_name,s.last_name,s.department,round(extract(epoch FROM (a.check_out_time-a.check_in_time))/3600,2) AS hours FROM staff_attendance a JOIN staff s ON s.id=a.staff_id WHERE a.school_id=$1${scope} ORDER BY a.attendance_date DESC,a.id DESC LIMIT 500`,
          args,
        ),
      );
    },
  );
  for (const action of ["check-in", "check-out"])
    r.post(`/attendance/staff/${action}`, async (req, res) => {
      const staffId = req.body.staff_id ? id.parse(req.body.staff_id) : null;
      let staff;
      if (staffId && permitted(req.user, "staff.attendance.write"))
        staff = await schoolRecord(db, req.user, "staff", staffId);
      else
        staff = await one(
          db,
          "SELECT * FROM staff WHERE school_id=$1 AND user_id=$2",
          [req.user.school_id, req.user.id],
        );
      if (!staff || staff.status !== "ACTIVE")
        fail(
          403,
          "An active staff profile linked to your account is required.",
        );
      const school = await currentSchool(db, req.user),
        clock = localClock(school.timezone);
      const result = await db.transaction(async (tx) => {
        await tx.query(
          "SELECT id FROM staff WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [req.user.school_id, staff.id],
        );
        let record;
        if (action === "check-in") {
          if (
            await one(
              tx,
              "SELECT id FROM staff_attendance WHERE staff_id=$1 AND attendance_date=$2",
              [staff.id, clock.date],
            )
          )
            fail(409, "This staff member already checked in today.");
          record = await insert(tx, "staff_attendance", {
            school_id: req.user.school_id,
            staff_id: staff.id,
            attendance_date: clock.date,
            check_in_time: new Date(),
            status: clock.time > school.staff_start ? "LATE" : "PRESENT",
          });
        } else {
          record = await one(
            tx,
            "UPDATE staff_attendance SET check_out_time=now() WHERE school_id=$1 AND staff_id=$2 AND attendance_date=$3 AND check_in_time IS NOT NULL AND check_out_time IS NULL RETURNING *",
            [req.user.school_id, staff.id, clock.date],
          );
          if (!record) fail(409, "No open check-in found for today.");
        }
        await audit(
          tx,
          req.user,
          "staff_attendance",
          record.id,
          action.toUpperCase(),
          null,
          record,
        );
        return record;
      });
      ok(res, result);
    });
  r.post(
    "/attendance/staff/status",
    requirePermission("staff.attendance.write"),
    async (req, res) => {
      const b = z
        .object({
          staff_id: id,
          date,
          status: z.enum([
            "ABSENT",
            "LEAVE",
            "SICK_LEAVE",
            "OFFICIAL_ASSIGNMENT",
          ]),
        })
        .parse(req.body);
      await schoolRecord(db, req.user, "staff", b.staff_id);
      const s = await db.transaction(async (tx) => {
        await tx.query(
          "SELECT id FROM staff WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [req.user.school_id, b.staff_id],
        );
        const record = await insert(tx, "staff_attendance", {
          school_id: req.user.school_id,
          staff_id: b.staff_id,
          attendance_date: b.date,
          status: b.status,
        });
        await audit(
          tx,
          req.user,
          "staff_attendance",
          record.id,
          "CREATE",
          null,
          record,
        );
        return record;
      });
      ok(res, s);
    },
  );

  r.get(
    "/finance/students",
    requirePermission("finance.read"),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          "SELECT s.id,s.first_name,s.last_name,s.student_number,s.discount_percent,s.scholarship_percent,c.name AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.school_id=$1 ORDER BY s.last_name",
          [req.user.school_id],
        ),
      ),
  );
  r.get(
    "/finance/fee-structures",
    requirePermission("finance.read"),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          "SELECT f.*,c.name AS class_name,t.name AS term_name FROM fee_structures f JOIN classes c ON c.id=f.class_id JOIN terms t ON t.id=f.term_id WHERE f.school_id=$1 ORDER BY c.name,f.fee_category",
          [req.user.school_id],
        ),
      ),
  );
  r.post(
    "/finance/fee-structures",
    requirePermission("finance.write"),
    async (req, res) => {
      const b = z
        .object({
          class_id: id,
          term_id: id,
          fee_category: z.enum([
            "TUITION",
            "BOARDING",
            "TRANSPORT",
            "EXAM",
            "BOOKS",
            "UNIFORM",
            "MEALS",
            "ACTIVITY",
            "OTHER",
          ]),
          amount: z.union([z.string(), z.number()]),
        })
        .parse(req.body);
      const cls = await schoolRecord(db, req.user, "classes", b.class_id),
        term = await schoolRecord(db, req.user, "terms", b.term_id);
      if (cls.academic_year_id !== term.academic_year_id)
        fail(422, "Class and term must belong to the same academic year.");
      const amount = cents(b.amount);
      if (!amount) fail(422, "Fee must be greater than zero.");
      const f = await one(
        db,
        "INSERT INTO fee_structures(school_id,class_id,term_id,fee_category,amount_cents) VALUES($1,$2,$3,$4,$5) ON CONFLICT(class_id,term_id,fee_category) DO UPDATE SET amount_cents=EXCLUDED.amount_cents RETURNING *",
        [req.user.school_id, b.class_id, b.term_id, b.fee_category, amount],
      );
      await audit(db, req.user, "fee_structures", f.id, "UPSERT", null, f);
      ok(res, f);
    },
  );
  r.patch(
    "/finance/students/:id/concessions",
    requirePermission("finance.write"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        b = z
          .object({
            discount_percent: z.coerce.number().min(0).max(100),
            scholarship_percent: z.coerce.number().min(0).max(100),
          })
          .parse(req.body);
      const before = await schoolRecord(db, req.user, "students", sid);
      await db.query(
        "UPDATE students SET discount_percent=$1,scholarship_percent=$2 WHERE id=$3",
        [b.discount_percent, b.scholarship_percent, sid],
      );
      await audit(
        db,
        req.user,
        "students",
        sid,
        "CONCESSIONS",
        {
          discount_percent: before.discount_percent,
          scholarship_percent: before.scholarship_percent,
        },
        b,
      );
      ok(res, b);
    },
  );
  r.post(
    "/finance/invoices/generate",
    requirePermission("finance.write"),
    async (req, res) => {
      const b = z
        .object({ student_id: id, term_id: id, due_date: date })
        .parse(req.body);
      ok(res, await generateInvoice(db, req.user, b));
    },
  );
  r.get(
    "/finance/invoices",
    allow("finance.read", "finance.own"),
    async (req, res) =>
      ok(
        res,
        await invoiceList(
          db,
          req.user,
          req.query.term_id ? id.parse(req.query.term_id) : null,
        ),
      ),
  );
  r.get(
    "/finance/invoices/:id",
    allow("finance.read", "finance.own"),
    async (req, res) => {
      const invoice = await schoolRecord(
        db,
        req.user,
        "student_invoices",
        id.parse(req.params.id),
      );
      await studentAccess(db, req.user, invoice.student_id);
      ok(res, {
        ...invoice,
        items: await rows(
          db,
          "SELECT * FROM invoice_items WHERE school_id=$1 AND invoice_id=$2",
          [req.user.school_id, invoice.id],
        ),
        payments: await rows(
          db,
          "SELECT * FROM payments WHERE school_id=$1 AND invoice_id=$2 ORDER BY paid_at DESC",
          [req.user.school_id, invoice.id],
        ),
        plans: await rows(
          db,
          "SELECT * FROM payment_plans WHERE school_id=$1 AND invoice_id=$2 ORDER BY due_date",
          [req.user.school_id, invoice.id],
        ),
      });
    },
  );
  r.post(
    "/finance/invoices/:id/waive",
    requirePermission("finance.write"),
    async (req, res) => {
      const iid = id.parse(req.params.id),
        reason = text.parse(req.body.reason);
      await db.transaction(async (tx) => {
        const i = await one(
          tx,
          "SELECT * FROM student_invoices WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [req.user.school_id, iid],
        );
        if (!i) fail(404, "Invoice not found.");
        if (Number(i.paid_cents) > 0)
          fail(422, "An invoice with payments cannot be waived.");
        await tx.query("UPDATE student_invoices SET waived=true WHERE id=$1", [
          iid,
        ]);
        await audit(tx, req.user, "student_invoices", iid, "WAIVE", i, {
          reason,
        });
      });
      ok(res, { ok: true });
    },
  );
  r.post(
    "/finance/payments",
    requirePermission("finance.write"),
    async (req, res) => {
      const { amount, ...b } = z
        .object({
          invoice_id: id,
          amount: z.union([z.string(), z.number()]),
          payment_method: z.enum([
            "CASH",
            "BANK_TRANSFER",
            "CARD",
            "INSTALLMENT",
          ]),
          reference_number: optionalText,
          idempotency_key: text.max(100),
        })
        .parse(req.body);
      ok(
        res,
        await recordPayment(db, req.user, {
          ...b,
          amount_cents: cents(amount),
        }),
      );
    },
  );
  r.post(
    "/finance/invoices/:id/plans",
    requirePermission("finance.write"),
    async (req, res) => {
      const iid = id.parse(req.params.id),
        b = z
          .object({
            due_date: date,
            amount: z.union([z.string(), z.number()]),
            note: optionalText,
          })
          .parse(req.body);
      const p = await createPaymentPlan(db, req.user, iid, {
        due_date: b.due_date,
        amount_cents: cents(b.amount),
        note: b.note,
      });
      ok(res, p);
    },
  );
  r.post(
    "/finance/invoices/:id/reminder",
    requirePermission("finance.write"),
    async (req, res) => {
      const i = await schoolRecord(
          db,
          req.user,
          "student_invoices",
          id.parse(req.params.id),
        ),
        s = await schoolRecord(db, req.user, "students", i.student_id);
      if (i.waived || Number(i.paid_cents) >= Number(i.total_cents))
        fail(422, "This invoice has no outstanding balance.");
      const school = await currentSchool(db, req.user);
      await db.query(
        "INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,dedupe_key) DO NOTHING",
        [
          req.user.school_id,
          s.parent_user_id,
          s.guardian_email,
          "School fee reminder",
          `Invoice ${i.invoice_number} has an outstanding balance of ${school.currency_code} ${((Number(i.total_cents) - Number(i.paid_cents)) / 100).toFixed(2)}. Please contact the finance office.`,
          `reminder:${i.id}:${localClock(school.timezone).date}`,
        ],
      );
      ok(res, {
        message: (await smtpConfig(db, req.user.school_id))
          ? "Reminder queued for email delivery."
          : "Reminder saved in the outbox. Email delivery requires SMTP configuration.",
      });
    },
  );
  r.get("/notifications", async (req, res) =>
    ok(
      res,
      await rows(
        db,
        permitted(req.user, "admin.write")
          ? "SELECT id,title,body,delivery_status,created_at FROM notifications WHERE school_id=$1 ORDER BY created_at DESC LIMIT 100"
          : "SELECT id,title,body,delivery_status,created_at FROM notifications WHERE school_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100",
        permitted(req.user, "admin.write")
          ? [req.user.school_id]
          : [req.user.school_id, req.user.id],
      ),
    ),
  );
  r.get("/audit", requirePermission("admin.write"), async (req, res) =>
    ok(
      res,
      await rows(
        db,
        "SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.school_id=$1 ORDER BY a.occurred_at DESC LIMIT 200",
        [req.user.school_id],
      ),
    ),
  );
  r.patch(
    "/classes/:id",
    allow("admin.write", "classes.write"),
    async (req, res) => {
      const cid = id.parse(req.params.id),
        b = z
          .object({
            name: text,
            capacity: z.coerce.number().int().min(1).max(500),
            academic_year_id: id,
            teacher_user_id: id.nullable().default(null),
          })
          .parse(req.body);
      await db.transaction(async (tx) => {
        const before = await schoolRecord(tx, req.user, "classes", cid);
        if (before.academic_year_id !== b.academic_year_id)
          fail(422, "Create a new class for a different academic year.");
        if (b.teacher_user_id) {
          const u = await schoolRecord(
            tx,
            req.user,
            "users",
            b.teacher_user_id,
          );
          if (u.role !== "TEACHER")
            fail(422, "Choose an account with the Teacher role.");
        }
        const count = await one(
          tx,
          "SELECT count(*)::int AS n FROM students WHERE school_id=$1 AND class_id=$2 AND status='ENROLLED'",
          [req.user.school_id, cid],
        );
        if (b.capacity < count.n)
          fail(422, "Capacity cannot be lower than current enrollment.");
        await tx.query(
          "UPDATE classes SET name=$1,capacity=$2,teacher_user_id=$3 WHERE id=$4",
          [b.name, b.capacity, b.teacher_user_id, cid],
        );
        await audit(tx, req.user, "classes", cid, "UPDATE", before, b);
      });
      ok(res, { ok: true });
    },
  );
  r.patch(
    "/terms/:id/current",
    requirePermission("admin.write"),
    async (req, res) => {
      const tid = id.parse(req.params.id);
      await db.transaction(async (tx) => {
        await schoolRecord(tx, req.user, "terms", tid);
        await tx.query("UPDATE terms SET is_current=false WHERE school_id=$1", [
          req.user.school_id,
        ]);
        await tx.query("UPDATE terms SET is_current=true WHERE id=$1", [tid]);
        await audit(tx, req.user, "terms", tid, "SET_CURRENT");
      });
      ok(res, { ok: true });
    },
  );
  r.patch(
    "/students/:id/status",
    requirePermission("students.write"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        b = z
          .object({
            status: z.enum(["WITHDRAWN", "GRADUATED", "SUSPENDED", "ENROLLED"]),
            reason: text,
          })
          .parse(req.body);
      await db.transaction(async (tx) => {
        const s = await studentAccess(tx, req.user, sid);
        if (
          !["ENROLLED", "SUSPENDED"].includes(s.status) ||
          (b.status === "ENROLLED" && s.status !== "SUSPENDED")
        )
          fail(
            422,
            "Only enrolled students can enter this status. Use admissions for new enrollment.",
          );
        await tx.query(
          "UPDATE students SET status=$1,updated_at=now() WHERE id=$2",
          [b.status, sid],
        );
        if (["WITHDRAWN", "GRADUATED"].includes(b.status))
          await tx.query(
            "UPDATE student_enrollment SET status=$1 WHERE student_id=$2 AND status='ACTIVE'",
            [b.status, sid],
          );
        await audit(
          tx,
          req.user,
          "students",
          sid,
          "STATUS_CHANGE",
          { status: s.status },
          b,
        );
      });
      ok(res, { ok: true });
    },
  );
  r.patch("/terms/:id", requirePermission("admin.write"), async (req, res) => {
    const tid = id.parse(req.params.id),
      b = z
        .object({ name: text, start_date: date, end_date: date })
        .parse(req.body);
    await db.transaction(async (tx) => {
      const term = await schoolRecord(tx, req.user, "terms", tid),
        year = await schoolRecord(
          tx,
          req.user,
          "academic_years",
          term.academic_year_id,
        );
      if (
        b.start_date < year.start_date ||
        b.end_date > year.end_date ||
        b.start_date > b.end_date
      )
        fail(422, "Term dates must lie within the academic year.");
      await tx.query(
        "UPDATE terms SET name=$1,start_date=$2,end_date=$3 WHERE id=$4",
        [b.name, b.start_date, b.end_date, tid],
      );
      await audit(tx, req.user, "terms", tid, "UPDATE", term, b);
    });
    ok(res, { ok: true });
  });
  return r;
}
