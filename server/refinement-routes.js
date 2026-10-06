import express from "express";
import multer from "multer";
import { DOCUMENT_MAX_BYTES } from "./document-limits.js";
import path from "node:path";
import { z, id, text, date } from "./validation.js";
import { one, rows, insert, audit } from "./db.js";
import { fail, requirePermission, permitted, token } from "./security.js";
import { schoolRecord } from "./services.js";
import {
  academicClass,
  assertEditable,
  academicPolicy,
  reportAccess,
  matchTerm,
} from "./academic-service.js";
import { policySchema } from "./academic-routes.js";
import { termRoster, workCalendar, workingDates } from "./history-service.js";
import { reviewSnapshot } from "./operations-service.js";
const ok = (res, data) => res.json({ data, errors: [] });
const reason = z.string().trim().min(5).max(2000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 2 },
});
export function refinementRoutes(db, options = {}) {
  const r = express.Router();
  r.get(
    "/academics/roster",
    requirePermission("academics.manage"),
    async (req, res) => {
      const c = id.parse(req.query.class_id),
        t = id.parse(req.query.term_id);
      await academicClass(db, req.user, c);
      const classPolicy = await one(
          db,
          "SELECT * FROM academic_class_policies WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
          [req.user.school_id, c, t],
        ),
        school = await academicPolicy(db, req.user.school_id);
      ok(res, {
        students: await termRoster(db, req.user, c, t),
        candidates: await rows(
          db,
          "SELECT id,first_name,last_name,student_number FROM students WHERE school_id=$1 ORDER BY last_name,first_name",
          [req.user.school_id],
        ),
        policy: classPolicy || {
          label: "School defaults",
          policy: {
            grading_scale: school.grading_scale,
            pass_mark: school.pass_mark,
            ranking_enabled: school.ranking_enabled,
            gpa_enabled: school.gpa_enabled,
            decline_threshold: school.decline_threshold,
            repeated_failure_terms: school.repeated_failure_terms,
            risk_attendance_threshold: school.risk_attendance_threshold,
            curriculum_lag_weeks: school.curriculum_lag_weeks,
          },
        },
      });
    },
  );
  r.post(
    "/academics/roster",
    requirePermission("academics.manage"),
    async (req, res) => {
      const b = z
          .object({
            class_id: id,
            term_id: id,
            student_id: id,
            excluded: z.boolean().default(false),
            subject_ids: z.array(id).min(1).max(100).nullable().default(null),
            reason,
          })
          .parse(req.body),
        u = req.user;
      await db.transaction(async (tx) => {
        await academicClass(tx, u, b.class_id, { lock: true });
        await assertEditable(tx, u, b.class_id, b.term_id);
        await termRoster(tx, u, b.class_id, b.term_id);
        await schoolRecord(tx, u, "students", b.student_id);
        if (b.subject_ids) {
          if (new Set(b.subject_ids).size !== b.subject_ids.length)
            fail(422, "Subject selections must be unique.");
          for (const sid of b.subject_ids) {
            const s = await schoolRecord(tx, u, "class_subjects", sid);
            if (s.class_id !== b.class_id)
              fail(422, "Select subjects assigned to this class.");
          }
        }
        if (
          b.excluded &&
          (await one(
            tx,
            "SELECT rc.id FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id JOIN report_revisions h ON h.report_card_id=rc.id WHERE rc.student_id=$1 AND b.class_id=$2 AND b.term_id=$3",
            [b.student_id, b.class_id, b.term_id],
          ))
        )
          fail(
            409,
            "This student has an archived report. Preserve their historical roster membership.",
          );
        const prior = await one(
          tx,
          "SELECT * FROM academic_rosters WHERE school_id=$1 AND class_id=$2 AND term_id=$3 AND student_id=$4",
          [u.school_id, b.class_id, b.term_id, b.student_id],
        );
        await tx.query(
          "INSERT INTO academic_rosters(school_id,class_id,term_id,student_id,excluded,subject_ids,source) VALUES($1,$2,$3,$4,$5,$6,'MANUAL_CORRECTION') ON CONFLICT(school_id,class_id,term_id,student_id) DO UPDATE SET excluded=EXCLUDED.excluded,subject_ids=EXCLUDED.subject_ids,source=EXCLUDED.source",
          [
            u.school_id,
            b.class_id,
            b.term_id,
            b.student_id,
            b.excluded,
            b.subject_ids ? JSON.stringify(b.subject_ids) : null,
          ],
        );
        await audit(tx, u, "academic_rosters", b.student_id, "AMEND", prior, b);
      });
      ok(res, { ok: true });
    },
  );
  r.post(
    "/academics/class-policy",
    requirePermission("academics.manage"),
    async (req, res) => {
      const b = z
          .object({
            class_id: id,
            term_id: id,
            label: text,
            policy: policySchema,
            reason,
          })
          .parse(req.body),
        p = b.policy;
      p.grading_scale.sort((a, b) => b.minimum - a.minimum);
      if (
        p.grading_scale.at(-1).minimum !== 0 ||
        new Set(p.grading_scale.map((g) => g.minimum)).size !==
          p.grading_scale.length ||
        new Set(p.grading_scale.map((g) => g.letter)).size !==
          p.grading_scale.length
      )
        fail(
          422,
          "Grade letters and thresholds must be unique, with a final threshold of zero.",
        );
      await db.transaction(async (tx) => {
        await academicClass(tx, req.user, b.class_id, { lock: true });
        await assertEditable(tx, req.user, b.class_id, b.term_id);
        await tx.query(
          "INSERT INTO academic_class_policies(school_id,class_id,term_id,label,policy) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,class_id,term_id) DO UPDATE SET label=EXCLUDED.label,policy=EXCLUDED.policy",
          [
            req.user.school_id,
            b.class_id,
            b.term_id,
            b.label,
            JSON.stringify(p),
          ],
        );
        await audit(
          tx,
          req.user,
          "academic_class_policies",
          b.class_id,
          "AMEND",
          null,
          b,
        );
      });
      ok(res, { ok: true });
    },
  );
  r.get(
    "/report-cards/:id/revisions",
    requirePermission("reports.academic.read"),
    async (req, res) => {
      const card = await reportAccess(db, req.user, id.parse(req.params.id));
      ok(
        res,
        await rows(
          db,
          "SELECT revision,reason,archived_at FROM report_revisions WHERE school_id=$1 AND report_card_id=$2 ORDER BY revision DESC",
          [req.user.school_id, card.id],
        ),
      );
    },
  );
  r.get(
    "/academics/exams",
    requirePermission("academics.read"),
    async (req, res) => {
      const t = await schoolRecord(
        db,
        req.user,
        "terms",
        id.parse(req.query.term_id),
      );
      ok(
        res,
        await rows(
          db,
          `SELECT e.*,c.name AS class_name,s.name AS subject_name,u.name AS invigilator_name FROM exam_sessions e JOIN class_subjects cs ON cs.id=e.class_subject_id JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id JOIN users u ON u.id=e.invigilator_id WHERE e.school_id=$1 AND e.term_id=$2${req.user.role === "TEACHER" ? " AND (cs.teacher_user_id=$3 OR c.teacher_user_id=$3 OR e.invigilator_id=$3)" : ""} ORDER BY e.exam_date,e.start_time`,
          req.user.role === "TEACHER"
            ? [req.user.school_id, t.id, req.user.id]
            : [req.user.school_id, t.id],
        ),
      );
    },
  );
  r.post(
    "/academics/exams",
    requirePermission("academics.manage"),
    async (req, res) => {
      const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        b = z
          .object({
            id: id.optional(),
            class_subject_id: id,
            term_id: id,
            exam_date: date,
            start_time: time,
            end_time: time,
            room: text,
            invigilator_id: id,
            reason,
          })
          .parse(req.body),
        u = req.user;
      const record = await db.transaction(async (tx) => {
        // A school lock serializes room, class and invigilator conflict checks.
        await tx.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          u.school_id,
        ]);
        const cs = await schoolRecord(
            tx,
            u,
            "class_subjects",
            b.class_subject_id,
          ),
          t = await matchTerm(tx, u, cs.class_id, b.term_id),
          inv = await schoolRecord(tx, u, "users", b.invigilator_id);
        if (["PARENT", "STUDENT"].includes(inv.role) || inv.status !== "ACTIVE")
          fail(422, "Choose an active staff account as invigilator.");
        if (
          b.end_time <= b.start_time ||
          b.exam_date < t.start_date ||
          b.exam_date > t.end_date
        )
          fail(422, "Exam times must be ordered and its date within the term.");
        if (b.id) await schoolRecord(tx, u, "exam_sessions", b.id);
        const conflict = await one(
          tx,
          "SELECT e.id FROM exam_sessions e JOIN class_subjects cs ON cs.id=e.class_subject_id WHERE e.school_id=$1 AND e.exam_date=$2 AND e.start_time<$4 AND e.end_time>$3 AND ($5::int IS NULL OR e.id<>$5) AND (lower(e.room)=lower($6) OR e.invigilator_id=$7 OR cs.class_id=$8)",
          [
            u.school_id,
            b.exam_date,
            b.start_time,
            b.end_time,
            b.id || null,
            b.room,
            b.invigilator_id,
            cs.class_id,
          ],
        );
        if (conflict)
          fail(
            409,
            "The class, room or invigilator is already booked during this time.",
          );
        const { reason, id: examId, ...data } = b;
        let e;
        if (examId)
          e = await one(
            tx,
            "UPDATE exam_sessions SET class_subject_id=$2,term_id=$3,exam_date=$4,start_time=$5,end_time=$6,room=$7,invigilator_id=$8 WHERE id=$1 RETURNING *",
            [
              examId,
              data.class_subject_id,
              data.term_id,
              data.exam_date,
              data.start_time,
              data.end_time,
              data.room,
              data.invigilator_id,
            ],
          );
        else
          e = await insert(tx, "exam_sessions", {
            school_id: u.school_id,
            ...data,
          });
        await audit(
          tx,
          u,
          "exam_sessions",
          e.id,
          examId ? "AMEND" : "CREATE",
          null,
          b,
        );
        return e;
      });
      ok(res, record);
    },
  );
  r.get(
    "/hr/calendar",
    requirePermission("operations.staff"),
    async (req, res) => ok(res, await workCalendar(db, req.user.school_id)),
  );
  r.post("/hr/calendar", requirePermission("hr.manage"), async (req, res) => {
    const b = z
      .object({
        weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        annual_leave_days: z.coerce.number().int().min(0).max(366),
        holidays: z.array(z.object({ date, name: text })).max(366),
        reason,
      })
      .parse(req.body);
    if (
      new Set(b.weekdays).size !== b.weekdays.length ||
      new Set(b.holidays.map((h) => h.date)).size !== b.holidays.length
    )
      fail(422, "Calendar entries must be unique.");
    await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
        req.user.school_id,
      ]);
      const prior = await workCalendar(tx, req.user.school_id);
      await tx.query(
        "UPDATE work_calendars SET weekdays=$2,annual_leave_days=$3 WHERE school_id=$1",
        [req.user.school_id, JSON.stringify(b.weekdays), b.annual_leave_days],
      );
      await tx.query("DELETE FROM school_holidays WHERE school_id=$1", [
        req.user.school_id,
      ]);
      for (const h of b.holidays)
        await insert(tx, "school_holidays", {
          school_id: req.user.school_id,
          ...h,
        });
      await audit(
        tx,
        req.user,
        "work_calendars",
        req.user.school_id,
        "AMEND",
        prior,
        b,
      );
    });
    ok(res, { ok: true });
  });
  r.get(
    "/hr/leave/estimate",
    requirePermission("operations.staff"),
    async (req, res) => {
      const from = date.parse(req.query.from),
        to = date.parse(req.query.to);
      if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000)
        fail(422, "Choose an ordered range of at most one year.");
      ok(res, { dates: await workingDates(db, req.user.school_id, from, to) });
    },
  );
  r.post(
    "/hr/leave/:id/cancel",
    requirePermission("operations.staff"),
    async (req, res) => {
      const b = z.object({ reason }).parse(req.body),
        u = req.user;
      await db.transaction(async (tx) => {
        const l = await one(
          tx,
          "SELECT * FROM leave_requests WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [u.school_id, id.parse(req.params.id)],
        );
        if (!l) fail(404, "Leave not found.");
        const s = await one(
          tx,
          "SELECT * FROM staff WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [u.school_id, l.staff_id],
        );
        if (
          !permitted(u, "hr.manage") &&
          (s.user_id !== u.id || l.status === "APPROVED")
        )
          fail(
            403,
            "HR must cancel approved leave; staff can withdraw their own pending requests.",
          );
        if (l.cancelled_at || l.status === "REJECTED")
          fail(409, "This request is already closed.");
        if (l.status === "APPROVED" && l.working_days === null)
          fail(
            409,
            "This legacy leave has no attendance audit. Reconcile its attendance with HR before cancellation.",
          );
        for (const change of await rows(
          tx,
          "SELECT * FROM leave_attendance_changes WHERE school_id=$1 AND leave_id=$2",
          [u.school_id, l.id],
        )) {
          const a = await one(
            tx,
            "SELECT * FROM staff_attendance WHERE id=$1 FOR UPDATE",
            [change.attendance_id],
          );
          if (!a || a.status !== "LEAVE" || a.check_in_time || a.check_out_time)
            fail(
              409,
              "Attendance has changed since approval. Reconcile it before cancelling.",
            );
          if (change.previous_record)
            await tx.query(
              "UPDATE staff_attendance SET status=$2,check_in_time=$3,check_out_time=$4 WHERE id=$1",
              [
                a.id,
                change.previous_record.status,
                change.previous_record.check_in_time,
                change.previous_record.check_out_time,
              ],
            );
          else
            await tx.query("DELETE FROM staff_attendance WHERE id=$1", [a.id]);
        }
        await tx.query(
          "UPDATE leave_requests SET cancelled_at=now(),cancellation_note=$2 WHERE id=$1",
          [l.id, b.reason],
        );
        await audit(tx, u, "leave_requests", l.id, "CANCEL", l, b);
      });
      ok(res, { ok: true });
    },
  );
  r.get(
    "/hr/staff/:id/documents",
    requirePermission("hr.manage"),
    async (req, res) => {
      const s = await schoolRecord(
        db,
        req.user,
        "staff",
        id.parse(req.params.id),
      );
      ok(
        res,
        await rows(
          db,
          "SELECT id,name,category,mime,size,created_at FROM staff_documents WHERE school_id=$1 AND staff_id=$2 ORDER BY id DESC",
          [req.user.school_id, s.id],
        ),
      );
    },
  );
  r.post(
    "/hr/staff/:id/documents",
    requirePermission("hr.manage"),
    upload.single("file"),
    async (req, res) => {
      const s = await schoolRecord(
          db,
          req.user,
          "staff",
          id.parse(req.params.id),
        ),
        category = z
          .enum([
            "CONTRACT",
            "QUALIFICATION",
            "CERTIFICATION",
            "TRAINING",
            "OTHER",
          ])
          .parse(req.body.category),
        f = req.file;
      if (!f) fail(422, "Choose a document.");
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
      await options.documentStorage.put(key, f.buffer, mime);
      let doc;
      try {
        doc = await db.transaction(async (tx) => {
          const d = await insert(tx, "staff_documents", {
            school_id: req.user.school_id,
            staff_id: s.id,
            name: path
              .basename(f.originalname)
              .replace(/[\r\n]/g, "")
              .slice(0, 200),
            category,
            storage_key: key,
            mime,
            size: f.size,
            uploaded_by: req.user.id,
          });
          await audit(tx, req.user, "staff_documents", d.id, "CREATE", null, {
            staff_id: s.id,
            name: d.name,
            category,
          });
          return d;
        });
      } catch (e) {
        await options.documentStorage.delete(key);
        throw e;
      }
      ok(res, { id: doc.id });
    },
  );
  r.get(
    "/hr/documents/:id",
    requirePermission("hr.manage"),
    async (req, res) => {
      const d = await schoolRecord(
        db,
        req.user,
        "staff_documents",
        id.parse(req.params.id),
      );
      await audit(db, req.user, "staff_documents", d.id, "DOWNLOAD");
      res
        .type(d.mime)
        .attachment(d.name)
        .send(await options.documentStorage.get(d.storage_key));
    },
  );
  r.get(
    "/hr/reviews/:id/history",
    requirePermission("hr.manage"),
    async (req, res) => {
      const review = await schoolRecord(
        db,
        req.user,
        "performance_reviews",
        id.parse(req.params.id),
      );
      ok(
        res,
        await rows(
          db,
          "SELECT revision,record,reason,created_at FROM review_revisions WHERE school_id=$1 AND review_id=$2 ORDER BY revision DESC",
          [req.user.school_id, review.id],
        ),
      );
    },
  );
  r.post(
    "/hr/reviews/:id/amend",
    requirePermission("hr.manage"),
    async (req, res) => {
      const b = z
          .object({
            revision: id,
            development_score: z.coerce.number().min(0).max(100),
            notes: reason,
            reason,
          })
          .parse(req.body),
        u = req.user;
      await db.transaction(async (tx) => {
        const old = await one(
          tx,
          "SELECT * FROM performance_reviews WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [u.school_id, id.parse(req.params.id)],
        );
        if (!old) fail(404, "Review not found.");
        if (old.revision !== b.revision)
          fail(409, "This review has changed. Reload before amending.");
        const snapshot = await reviewSnapshot(
          tx,
          u,
          old.staff_id,
          old.academic_year_id,
          b.development_score,
        );
        await insert(tx, "review_revisions", {
          school_id: u.school_id,
          review_id: old.id,
          revision: old.revision,
          record: JSON.stringify(old),
          reason: b.reason,
          changed_by: u.id,
        });
        await tx.query(
          "UPDATE performance_reviews SET development_score=$2,notes=$3,snapshot=$4,overall_score=$5,reviewed_by=$6,revision=revision+1 WHERE id=$1",
          [
            old.id,
            b.development_score,
            b.notes,
            JSON.stringify(snapshot),
            snapshot.overall,
            u.id,
          ],
        );
        await audit(tx, u, "performance_reviews", old.id, "AMEND", old, b);
      });
      ok(res, { ok: true });
    },
  );
  r.patch(
    "/surveys/:id",
    requirePermission("complaints.manage"),
    async (req, res) => {
      const b = z
        .object({
          title: text,
          questions: z.array(text).min(1).max(20),
          start_date: date,
          end_date: date,
          published: z.boolean(),
          reason,
        })
        .parse(req.body);
      if (b.end_date < b.start_date)
        fail(422, "End date must follow start date.");
      await db.transaction(async (tx) => {
        const s = await one(
          tx,
          "SELECT * FROM satisfaction_surveys WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [req.user.school_id, id.parse(req.params.id)],
        );
        if (!s) fail(404, "Survey not found.");
        if (s.published)
          fail(
            409,
            "Published survey questions are immutable. Create a new survey for a different questionnaire.",
          );
        await tx.query(
          "UPDATE satisfaction_surveys SET title=$2,questions=$3,start_date=$4,end_date=$5,published=$6 WHERE id=$1",
          [
            s.id,
            b.title,
            JSON.stringify(b.questions),
            b.start_date,
            b.end_date,
            b.published,
          ],
        );
        await audit(tx, req.user, "satisfaction_surveys", s.id, "AMEND", s, b);
      });
      ok(res, { ok: true });
    },
  );
  return r;
}
