import express from "express";
import { termRoster, archiveBatch } from "./history-service.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { z, text, optionalText, id, date } from "./validation.js";
import { one, rows, insert, audit } from "./db.js";
import { fail, requirePermission, permitted, localClock } from "./security.js";
import { schoolRecord, currentSchool } from "./services.js";
import {
  academicPolicy,
  grade,
  round,
  academicClass,
  assignedSubject,
  matchTerm,
  assertEditable,
  subjectResults,
  buildReports,
  evaluateRisk,
  reportAccess,
  curriculumRows,
  groupCurriculum,
  academicAnalytics,
} from "./academic-service.js";

const decimal = z.coerce
  .number()
  .finite()
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use at most two decimal places.",
  );
const allow =
  (...permissions) =>
  (req, res, next) => {
    if (!permissions.some((p) => permitted(req.user, p)))
      fail(403, "Your role cannot access this academic resource.");
    next();
  };
const ok = (res, data) => res.json({ data, errors: [] });
export const policySchema = z.object({
  grading_scale: z
    .array(
      z.object({
        letter: text.max(5),
        minimum: z.coerce.number().min(0).max(100),
        points: z.coerce.number().min(0).max(10),
      }),
    )
    .min(2)
    .max(15),
  pass_mark: z.coerce.number().min(0).max(100),
  ranking_enabled: z.boolean(),
  gpa_enabled: z.boolean(),
  decline_threshold: z.coerce.number().gt(0).max(100),
  repeated_failure_terms: z.coerce.number().int().min(2).max(6),
  risk_attendance_threshold: z.coerce.number().int().min(1).max(100),
  curriculum_lag_weeks: z.coerce.number().int().min(0).max(12),
});
const assessmentSchema = z.object({
  class_subject_id: id,
  term_id: id,
  name: text,
  type: z.enum(["ASSIGNMENT", "TEST", "CA", "PRACTICAL", "PROJECT", "EXAM"]),
  max_score: decimal.refine((n) => n > 0 && n <= 10000),
  weight_percent: decimal.refine((n) => n > 0 && n <= 100),
  assessment_date: date,
});
const topicSchema = z.object({
  class_subject_id: id,
  term_id: id,
  topic_name: text,
  planned_week: z.coerce.number().int().min(1).max(53),
  sequence_order: z.coerce.number().int().min(1).max(10000),
});

export function parseTopicCsv(input) {
  const grid = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  const csv = input.replace(/^\uFEFF/, "");
  for (let i = 0; i <= csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === undefined) fail(422, "CSV contains an unclosed quoted field.");
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      if (cell.trim() || closed) fail(422, "Unexpected quote in CSV.");
      quoted = true;
      cell = "";
      continue;
    }
    if (ch === "," || ch === "\n" || ch === "\r" || ch === undefined) {
      row.push(cell.trim());
      cell = "";
      closed = false;
      if (ch !== ",") {
        if (row.some(Boolean)) grid.push(row);
        row = [];
        if (ch === "\r" && csv[i + 1] === "\n") i++;
      }
      continue;
    }
    if (closed && !/\s/.test(ch))
      fail(422, "Unexpected text after a quoted CSV field.");
    cell += ch;
  }
  const expected = ["topic_name", "planned_week", "sequence_order"];
  if (!grid.length || grid[0].join(",") !== expected.join(","))
    fail(422, "CSV headers must be topic_name,planned_week,sequence_order.");
  if (grid.length < 2 || grid.length > 501)
    fail(422, "Import between 1 and 500 topics.");
  return grid.slice(1).map((values, index) => {
    if (values.length !== 3)
      fail(422, `CSV row ${index + 2} must have three fields.`);
    return Object.fromEntries(expected.map((key, i) => [key, values[i]]));
  });
}
export function academicRoutes(db) {
  const r = express.Router();
  r.get(
    "/academics/setup",
    allow(
      "academics.read",
      "analytics.summary",
      "curriculum.read",
      "curriculum.summary",
    ),
    async (req, res) => {
      const u = req.user,
        manager = permitted(u, "academics.manage");
      const classes = await rows(
        db,
        `SELECT c.* FROM classes c WHERE c.school_id=$1${u.role === "TEACHER" ? " AND (c.teacher_user_id=$2 OR EXISTS(SELECT 1 FROM class_subjects cs WHERE cs.class_id=c.id AND cs.teacher_user_id=$2))" : ""} ORDER BY c.name`,
        u.role === "TEACHER" ? [u.school_id, u.id] : [u.school_id],
      );
      const assignments = await rows(
        db,
        `SELECT cs.*,c.name AS class_name,c.academic_year_id,s.name AS subject_name,s.code,s.department,u.name AS teacher_name FROM class_subjects cs JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id JOIN users u ON u.id=cs.teacher_user_id WHERE cs.school_id=$1${u.role === "TEACHER" ? " AND cs.teacher_user_id=$2" : ""} ORDER BY c.name,s.name`,
        u.role === "TEACHER" ? [u.school_id, u.id] : [u.school_id],
      );
      ok(res, {
        classes,
        assignments,
        subjects: await rows(
          db,
          "SELECT * FROM subjects WHERE school_id=$1 ORDER BY name",
          [u.school_id],
        ),
        teachers: manager
          ? await rows(
              db,
              "SELECT id,name FROM users WHERE school_id=$1 AND role='TEACHER' AND status='ACTIVE' ORDER BY name",
              [u.school_id],
            )
          : [],
        policy: await academicPolicy(db, u.school_id),
        controls: await rows(
          db,
          "SELECT * FROM academic_term_controls WHERE school_id=$1",
          [u.school_id],
        ),
      });
    },
  );
  r.get(
    "/subjects",
    allow("academics.read", "curriculum.read"),
    async (req, res) =>
      ok(
        res,
        await rows(
          db,
          "SELECT * FROM subjects WHERE school_id=$1 ORDER BY name",
          [req.user.school_id],
        ),
      ),
  );
  r.post(
    "/subjects",
    requirePermission("academics.manage"),
    async (req, res) => {
      const b = z
        .object({
          name: text,
          code: text.max(20),
          department: text.default("General"),
        })
        .parse(req.body);
      const s = await insert(db, "subjects", {
        school_id: req.user.school_id,
        ...b,
        code: b.code.toUpperCase(),
      });
      await audit(db, req.user, "subjects", s.id, "CREATE", null, s);
      ok(res, s);
    },
  );
  r.post(
    "/class-subjects",
    requirePermission("academics.manage"),
    async (req, res) => {
      const b = z
        .object({
          class_id: id,
          subject_id: id,
          teacher_user_id: id,
          credits: decimal.refine((n) => n > 0 && n <= 20).default(1),
        })
        .parse(req.body);
      await academicClass(db, req.user, b.class_id);
      await schoolRecord(db, req.user, "subjects", b.subject_id);
      const teacher = await schoolRecord(
        db,
        req.user,
        "users",
        b.teacher_user_id,
      );
      if (teacher.role !== "TEACHER" || teacher.status !== "ACTIVE")
        fail(422, "Choose an active teacher account.");
      const cs = await db.transaction(async (tx) => {
        await academicClass(tx, req.user, b.class_id, { lock: true });
        const before = await one(
          tx,
          "SELECT * FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND subject_id=$3",
          [req.user.school_id, b.class_id, b.subject_id],
        );
        const row = await one(
          tx,
          "INSERT INTO class_subjects(school_id,class_id,subject_id,teacher_user_id,credits) VALUES($1,$2,$3,$4,$5) ON CONFLICT(class_id,subject_id) DO UPDATE SET teacher_user_id=EXCLUDED.teacher_user_id,credits=EXCLUDED.credits RETURNING *",
          [
            req.user.school_id,
            b.class_id,
            b.subject_id,
            b.teacher_user_id,
            b.credits,
          ],
        );
        await audit(
          tx,
          req.user,
          "class_subjects",
          row.id,
          before ? "UPDATE" : "CREATE",
          before,
          row,
        );
        return row;
      });
      ok(res, cs);
    },
  );
  r.patch(
    "/academics/settings",
    requirePermission("academics.manage"),
    async (req, res) => {
      const b = policySchema.parse(req.body);
      b.grading_scale.sort((a, b) => b.minimum - a.minimum);
      if (
        b.grading_scale.at(-1).minimum !== 0 ||
        new Set(b.grading_scale.map((g) => g.minimum)).size !==
          b.grading_scale.length ||
        new Set(b.grading_scale.map((g) => g.letter)).size !==
          b.grading_scale.length
      )
        fail(
          422,
          "Grade thresholds and letters must be unique, and the lowest threshold must be zero.",
        );
      await db.transaction(async (tx) => {
        const previous = await academicPolicy(tx, req.user.school_id);
        await tx.query(
          "UPDATE academic_settings SET grading_scale=$1,pass_mark=$2,ranking_enabled=$3,gpa_enabled=$4,decline_threshold=$5,repeated_failure_terms=$6,risk_attendance_threshold=$7,curriculum_lag_weeks=$8,updated_at=now() WHERE school_id=$9",
          [
            JSON.stringify(b.grading_scale),
            b.pass_mark,
            b.ranking_enabled,
            b.gpa_enabled,
            b.decline_threshold,
            b.repeated_failure_terms,
            b.risk_attendance_threshold,
            b.curriculum_lag_weeks,
            req.user.school_id,
          ],
        );
        await audit(
          tx,
          req.user,
          "academic_settings",
          req.user.school_id,
          "UPDATE",
          previous,
          b,
        );
      });
      ok(res, b);
    },
  );
  r.patch(
    "/academics/terms/:id/control",
    requirePermission("admin.write"),
    async (req, res) => {
      const tid = id.parse(req.params.id),
        b = z
          .object({
            closed: z.boolean(),
            unlock_until: date.nullable().default(null),
            reason: text,
          })
          .parse(req.body);
      await schoolRecord(db, req.user, "terms", tid);
      const today = localClock(
        (await currentSchool(db, req.user)).timezone,
      ).date;
      if (b.unlock_until && b.unlock_until < today)
        fail(422, "Unlock expiry must be today or later.");
      const previous = await one(
        db,
        "SELECT * FROM academic_term_controls WHERE school_id=$1 AND term_id=$2",
        [req.user.school_id, tid],
      );
      await db.query(
        "INSERT INTO academic_term_controls(school_id,term_id,closed,unlock_until,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,term_id) DO UPDATE SET closed=EXCLUDED.closed,unlock_until=EXCLUDED.unlock_until,reason=EXCLUDED.reason",
        [req.user.school_id, tid, b.closed, b.unlock_until, b.reason],
      );
      await audit(db, req.user, "terms", tid, "ACADEMIC_CONTROL", previous, b);
      ok(res, b);
    },
  );
  r.post(
    "/academics/student-account",
    requirePermission("admin.write"),
    async (req, res) => {
      const b = z.object({ student_id: id, user_id: id }).parse(req.body);
      await schoolRecord(db, req.user, "students", b.student_id);
      const account = await schoolRecord(db, req.user, "users", b.user_id);
      if (account.role !== "STUDENT")
        fail(422, "Choose a Student user account.");
      await db.query(
        "INSERT INTO academic_student_accounts(school_id,student_id,user_id) VALUES($1,$2,$3) ON CONFLICT(school_id,student_id) DO UPDATE SET user_id=EXCLUDED.user_id",
        [req.user.school_id, b.student_id, b.user_id],
      );
      await audit(
        db,
        req.user,
        "students",
        b.student_id,
        "LINK_STUDENT_ACCOUNT",
        null,
        b,
      );
      ok(res, b);
    },
  );
  r.get(
    "/assessments",
    requirePermission("academics.read"),
    async (req, res) => {
      const tid = id.parse(req.query.term_id);
      await schoolRecord(db, req.user, "terms", tid);
      const args = [req.user.school_id, tid];
      let scope = "";
      if (req.user.role === "TEACHER") {
        args.push(req.user.id);
        scope = " AND cs.teacher_user_id=$3";
      }
      if (req.query.class_subject_id) {
        args.push(id.parse(req.query.class_subject_id));
        scope += ` AND a.class_subject_id=$${args.length}`;
      }
      ok(
        res,
        await rows(
          db,
          `SELECT a.*,c.name AS class_name,cs.class_id,s.name AS subject_name,(SELECT count(*)::int FROM student_scores sc WHERE sc.assessment_id=a.id) AS entered FROM assessments a JOIN class_subjects cs ON cs.id=a.class_subject_id JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id WHERE a.school_id=$1 AND a.term_id=$2${scope} ORDER BY c.name,s.name,a.assessment_date,a.id`,
          args,
        ),
      );
    },
  );
  async function saveAssessment(req, res) {
    const b = assessmentSchema.parse(req.body),
      aid = req.params.id ? id.parse(req.params.id) : null;
    const result = await db.transaction(async (tx) => {
      const cs = await assignedSubject(tx, req.user, b.class_subject_id);
      await academicClass(tx, req.user, cs.class_id, { lock: true });
      await assignedSubject(tx, req.user, b.class_subject_id);
      const term = await assertEditable(tx, req.user, cs.class_id, b.term_id);
      if (
        b.assessment_date < term.start_date ||
        b.assessment_date > term.end_date
      )
        fail(422, "Assessment date must lie within the term.");
      let before = null;
      if (aid) {
        before = await schoolRecord(tx, req.user, "assessments", aid);
        if (before.class_subject_id !== cs.id || before.term_id !== b.term_id)
          fail(422, "An existing assessment cannot change subject or term.");
        const max = await one(
          tx,
          "SELECT max(score) AS highest FROM student_scores WHERE assessment_id=$1",
          [aid],
        );
        if (max.highest !== null && Number(max.highest) > b.max_score)
          fail(
            422,
            "Maximum score cannot be lower than existing student scores.",
          );
      }
      const total = await one(
        tx,
        "SELECT coalesce(sum(weight_percent),0) AS weight FROM assessments WHERE class_subject_id=$1 AND term_id=$2 AND ($3::int IS NULL OR id<>$3)",
        [cs.id, b.term_id, aid],
      );
      if (round(Number(total.weight) + b.weight_percent) > 100)
        fail(
          422,
          "Assessment weights for this subject and term cannot exceed 100%.",
        );
      const a = aid
        ? await one(
            tx,
            "UPDATE assessments SET name=$1,type=$2,max_score=$3,weight_percent=$4,assessment_date=$5 WHERE id=$6 RETURNING *",
            [
              b.name,
              b.type,
              b.max_score,
              b.weight_percent,
              b.assessment_date,
              aid,
            ],
          )
        : await insert(tx, "assessments", {
            school_id: req.user.school_id,
            ...b,
            created_by: req.user.id,
          });
      await audit(
        tx,
        req.user,
        "assessments",
        a.id,
        aid ? "UPDATE" : "CREATE",
        before,
        a,
      );
      return a;
    });
    ok(res, result);
  }
  r.post(
    "/assessments",
    requirePermission("assessments.write"),
    saveAssessment,
  );
  r.patch(
    "/assessments/:id",
    requirePermission("assessments.write"),
    saveAssessment,
  );
  r.delete(
    "/assessments/:id",
    requirePermission("assessments.write"),
    async (req, res) => {
      const aid = id.parse(req.params.id);
      await db.transaction(async (tx) => {
        let a = await schoolRecord(tx, req.user, "assessments", aid);
        const cs = await assignedSubject(tx, req.user, a.class_subject_id);
        await academicClass(tx, req.user, cs.class_id, { lock: true });
        a = await schoolRecord(tx, req.user, "assessments", aid);
        await assignedSubject(tx, req.user, a.class_subject_id);
        await assertEditable(tx, req.user, cs.class_id, a.term_id);
        if (
          await one(
            tx,
            "SELECT id FROM student_scores WHERE assessment_id=$1 LIMIT 1",
            [aid],
          )
        )
          fail(422, "An assessment with scores cannot be deleted.");
        await tx.query("DELETE FROM assessments WHERE id=$1", [aid]);
        await audit(tx, req.user, "assessments", aid, "DELETE", a);
      });
      ok(res, { ok: true });
    },
  );
  r.get(
    "/assessments/:id/scores",
    requirePermission("academics.read"),
    async (req, res) => {
      const a = await schoolRecord(
          db,
          req.user,
          "assessments",
          id.parse(req.params.id),
        ),
        cs = await assignedSubject(db, req.user, a.class_subject_id),
        policy =
          (
            await one(
              db,
              "SELECT policy FROM academic_class_policies WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
              [req.user.school_id, cs.class_id, a.term_id],
            )
          )?.policy || (await academicPolicy(db, req.user.school_id));
      const members = await termRoster(db, req.user, cs.class_id, a.term_id),
        scores = await rows(
          db,
          "SELECT student_id,score FROM student_scores WHERE school_id=$1 AND assessment_id=$2",
          [req.user.school_id, a.id],
        );
      const roster = members
        .filter((s) => !s.subject_ids || s.subject_ids.includes(cs.id))
        .map((s) => ({
          ...s,
          score: scores.find((v) => v.student_id === s.id)?.score ?? null,
        }));
      let locked = false,
        lock_reason = "";
      try {
        await assertEditable(db, req.user, cs.class_id, a.term_id);
      } catch (e) {
        if (e.status !== 423) throw e;
        locked = true;
        lock_reason = e.message;
      }
      ok(res, {
        assessment: a,
        policy,
        locked,
        lock_reason,
        students: roster.map((s) => ({
          ...s,
          grade:
            s.score === null
              ? null
              : grade(
                  round((Number(s.score) / Number(a.max_score)) * 100),
                  policy,
                ).letter,
        })),
      });
    },
  );
  r.post(
    "/assessments/:id/scores",
    requirePermission("scores.write"),
    async (req, res) => {
      const aid = id.parse(req.params.id),
        b = z
          .object({
            scores: z
              .array(
                z.object({
                  student_id: id,
                  score: decimal.refine((n) => n >= 0).nullable(),
                }),
              )
              .min(1)
              .max(500),
          })
          .parse(req.body);
      if (new Set(b.scores.map((s) => s.student_id)).size !== b.scores.length)
        fail(422, "Each student may occur only once.");
      await db.transaction(async (tx) => {
        let a = await schoolRecord(tx, req.user, "assessments", aid);
        const cs = await assignedSubject(tx, req.user, a.class_subject_id);
        await academicClass(tx, req.user, cs.class_id, { lock: true });
        a = await schoolRecord(tx, req.user, "assessments", aid);
        await assignedSubject(tx, req.user, a.class_subject_id);
        await assertEditable(tx, req.user, cs.class_id, a.term_id);
        const roster = await termRoster(tx, req.user, cs.class_id, a.term_id);
        for (const score of b.scores) {
          const s = await schoolRecord(
            tx,
            req.user,
            "students",
            score.student_id,
          );
          if (
            !roster.some(
              (r) =>
                r.id === s.id &&
                (!r.subject_ids || r.subject_ids.includes(cs.id)),
            )
          )
            fail(
              422,
              "Scores must belong to students taking this subject in the class term roster.",
            );
          if (score.score !== null && score.score > Number(a.max_score))
            fail(
              422,
              `Score for ${s.first_name} exceeds the maximum of ${a.max_score}.`,
            );
          const before = await one(
            tx,
            "SELECT * FROM student_scores WHERE assessment_id=$1 AND student_id=$2",
            [aid, s.id],
          );
          if (score.score === null) {
            await tx.query(
              "DELETE FROM student_scores WHERE assessment_id=$1 AND student_id=$2",
              [aid, s.id],
            );
            if (before)
              await audit(
                tx,
                req.user,
                "student_scores",
                before.id,
                "CLEAR",
                before,
              );
          } else {
            const row = await one(
              tx,
              "INSERT INTO student_scores(school_id,assessment_id,student_id,score,entered_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=EXCLUDED.score,entered_by=EXCLUDED.entered_by,updated_at=now() RETURNING *",
              [req.user.school_id, aid, s.id, score.score, req.user.id],
            );
            await audit(
              tx,
              req.user,
              "student_scores",
              row.id,
              before ? "UPDATE" : "CREATE",
              before,
              row,
            );
          }
        }
      });
      ok(res, { saved: b.scores.length });
    },
  );
  r.get(
    "/academics/gradebook",
    requirePermission("academics.read"),
    async (req, res) => {
      const cid = id.parse(req.query.class_id),
        tid = id.parse(req.query.term_id);
      await academicClass(db, req.user, cid);
      ok(res, await subjectResults(db, req.user, cid, tid));
    },
  );
  r.get(
    "/report-batches",
    requirePermission("reports.academic.read"),
    async (req, res) => {
      const tid = id.parse(req.query.term_id);
      await schoolRecord(db, req.user, "terms", tid);
      ok(
        res,
        await rows(
          db,
          `SELECT b.*,c.name AS class_name,(SELECT count(*)::int FROM report_cards rc WHERE rc.batch_id=b.id) AS students FROM report_batches b JOIN classes c ON c.id=b.class_id WHERE b.school_id=$1 AND b.term_id=$2${req.user.role === "TEACHER" ? " AND c.teacher_user_id=$3" : ""} ORDER BY c.name`,
          req.user.role === "TEACHER"
            ? [req.user.school_id, tid, req.user.id]
            : [req.user.school_id, tid],
        ),
      );
    },
  );
  r.post(
    "/report-cards/generate",
    requirePermission("reports.generate"),
    async (req, res) => {
      const b = z.object({ class_id: id, term_id: id }).parse(req.body);
      ok(
        res,
        await db.transaction((tx) =>
          buildReports(tx, req.user, b.class_id, b.term_id),
        ),
      );
    },
  );
  r.post(
    "/report-batches/:id/finalize",
    requirePermission("reports.finalize"),
    async (req, res) => {
      const bid = id.parse(req.params.id);
      ok(
        res,
        await db.transaction(async (tx) => {
          const b = await schoolRecord(tx, req.user, "report_batches", bid);
          await buildReports(tx, req.user, b.class_id, b.term_id);
          await tx.query(
            "UPDATE report_batches SET status='FINALIZED',finalized_at=now() WHERE id=$1",
            [bid],
          );
          await evaluateRisk(tx, req.user.school_id);
          await audit(tx, req.user, "report_batches", bid, "FINALIZE");
          return { id: bid, status: "FINALIZED" };
        }),
      );
    },
  );
  async function publish(req, res, bid) {
    await db.transaction(async (tx) => {
      const b = await schoolRecord(tx, req.user, "report_batches", bid);
      await academicClass(tx, req.user, b.class_id, { lock: true });
      const current = await schoolRecord(tx, req.user, "report_batches", bid);
      if (current.status !== "FINALIZED")
        fail(422, "Finalize this report batch before publication.");
      await tx.query(
        "UPDATE report_batches SET status='PUBLISHED',published_at=now() WHERE id=$1",
        [bid],
      );
      await audit(tx, req.user, "report_batches", bid, "PUBLISH");
    });
    ok(res, { id: bid, status: "PUBLISHED" });
  }
  r.post(
    "/report-batches/:id/publish",
    requirePermission("reports.publish"),
    async (req, res) => publish(req, res, id.parse(req.params.id)),
  );
  r.patch(
    "/report-cards/:id/publish",
    requirePermission("reports.publish"),
    async (req, res) => {
      const card = await reportAccess(db, req.user, id.parse(req.params.id));
      await publish(req, res, card.batch_id);
    },
  );
  r.post(
    "/report-batches/:id/reopen",
    requirePermission("reports.finalize"),
    async (req, res) => {
      const bid = id.parse(req.params.id),
        reason = text.parse(req.body.reason);
      await db.transaction(async (tx) => {
        let b = await schoolRecord(tx, req.user, "report_batches", bid);
        await academicClass(tx, req.user, b.class_id, { lock: true });
        b = await schoolRecord(tx, req.user, "report_batches", bid);
        if (b.status === "DRAFT") fail(409, "This batch is already a draft.");
        if (b.status === "PUBLISHED" && !permitted(req.user, "reports.publish"))
          fail(
            403,
            "Only a publishing officer may withdraw published reports.",
          );
        await archiveBatch(tx, req.user, b, reason);
        await tx.query(
          "UPDATE report_batches SET status='DRAFT',revision=revision+1,finalized_at=NULL,published_at=NULL WHERE id=$1",
          [bid],
        );
        await evaluateRisk(tx, req.user.school_id);
        await audit(tx, req.user, "report_batches", bid, "REOPEN", b, {
          reason,
        });
      });
      ok(res, { ok: true });
    },
  );
  r.get(
    "/report-cards",
    allow("reports.academic.read", "reports.academic.own"),
    async (req, res) => {
      const args = [req.user.school_id],
        u = req.user;
      let scope = "";
      if (req.query.term_id) {
        args.push(id.parse(req.query.term_id));
        scope += ` AND b.term_id=$${args.length}`;
      }
      if (req.query.batch_id) {
        args.push(id.parse(req.query.batch_id));
        scope += ` AND b.id=$${args.length}`;
      }
      if (u.role === "PARENT") {
        args.push(u.id);
        scope += ` AND b.status='PUBLISHED' AND s.parent_user_id=$${args.length}`;
      }
      if (u.role === "STUDENT") {
        args.push(u.id);
        scope += ` AND b.status='PUBLISHED' AND EXISTS(SELECT 1 FROM academic_student_accounts sa WHERE sa.school_id=$1 AND sa.student_id=s.id AND sa.user_id=$${args.length})`;
      }
      if (u.role === "TEACHER") {
        args.push(u.id);
        scope += ` AND c.teacher_user_id=$${args.length}`;
      }
      ok(
        res,
        await rows(
          db,
          `SELECT rc.id,rc.student_id,rc.batch_id,rc.overall_average,rc.overall_grade,rc.gpa,rc.class_rank,b.status,b.revision,s.first_name,s.last_name,c.name AS class_name,t.name AS term_name FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id JOIN students s ON s.id=rc.student_id JOIN classes c ON c.id=b.class_id JOIN terms t ON t.id=b.term_id WHERE rc.school_id=$1${scope} ORDER BY s.last_name,s.first_name`,
          args,
        ),
      );
    },
  );
  r.get(
    "/report-cards/:id",
    allow("reports.academic.read", "reports.academic.own"),
    async (req, res) => {
      let card = await reportAccess(db, req.user, id.parse(req.params.id));
      if (req.query.revision) {
        if (!permitted(req.user, "reports.academic.read"))
          fail(
            403,
            "Archived revisions are available to authorized school staff only.",
          );
        const archived = await one(
          db,
          "SELECT record FROM report_revisions WHERE school_id=$1 AND report_card_id=$2 AND revision=$3",
          [req.user.school_id, card.id, id.parse(req.query.revision)],
        );
        if (!archived) fail(404, "Archived revision not found.");
        card = { ...archived.record, archived: true };
      }
      if (req.query.format !== "pdf") return ok(res, card);
      const doc = new PDFDocument({ size: "A4", margin: 45 });
      res
        .attachment(
          `report-${card.student_id}-${card.term_id}-v${card.revision}.pdf`,
        )
        .type("application/pdf");
      doc.pipe(res);
      const s = card.snapshot;
      doc
        .fontSize(22)
        .text(s.school_name)
        .moveDown(0.5)
        .fontSize(14)
        .text("STUDENT REPORT CARD")
        .fontSize(10)
        .text(
          `${s.year_name} / ${s.term_name} | ${s.class_name} | ${card.status} | Revision ${card.revision}`,
        )
        .moveDown();
      doc
        .fontSize(13)
        .text(s.student.name)
        .fontSize(10)
        .text(`Student ID: ${s.student.student_number || "—"}`)
        .moveDown();
      for (const subject of s.subjects) {
        if (doc.y > 650) doc.addPage();
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(`${subject.subject_name} (${subject.code})`)
          .font("Helvetica")
          .fontSize(10)
          .text(
            `Total: ${subject.total}% | Grade: ${subject.grade} | ${subject.passed ? "Pass" : "Below pass mark"}`,
          )
          .fontSize(8)
          .text(
            subject.assessments
              .map(
                (a) =>
                  `${a.name}: ${a.score}/${a.max_score} (${a.weight_percent}%)`,
              )
              .join("   "),
          )
          .moveDown();
      }
      doc
        .fontSize(12)
        .text(
          `Overall: ${card.overall_average}% | Grade: ${card.overall_grade}`,
        );
      if (card.gpa !== null) doc.text(`GPA: ${card.gpa}`);
      if (card.class_rank !== null)
        doc.text(`Class position: ${card.class_rank}`);
      doc
        .fontSize(10)
        .text(
          `Attendance: ${s.attendance.percentage === null ? "Not recorded" : `${s.attendance.percentage}% (${s.attendance.present}/${s.attendance.recorded} recorded days)`}`,
        )
        .moveDown()
        .text(`Teacher comment: ${card.teacher_comment || "—"}`)
        .moveDown(0.5)
        .text(`Principal comment: ${card.principal_comment || "—"}`)
        .moveDown()
        .fontSize(8)
        .text(
          `Grading scale: ${s.policy.grading_scale.map((g) => `${g.letter} >= ${g.minimum}`).join(" | ")}. Pass mark: ${s.policy.pass_mark}%.`,
        );
      doc.end();
      await audit(db, req.user, "report_cards", card.id, "EXPORT", null, {
        format: "pdf",
      });
    },
  );
  r.patch(
    "/report-cards/:id/comments",
    requirePermission("reports.academic.read"),
    async (req, res) => {
      const rid = id.parse(req.params.id),
        b = z
          .object({
            teacher_comment: optionalText,
            principal_comment: optionalText,
          })
          .parse(req.body);
      await db.transaction(async (tx) => {
        const card = await reportAccess(tx, req.user, rid);
        await academicClass(tx, req.user, card.class_id, { lock: true });
        const current = await reportAccess(tx, req.user, rid);
        if (current.status !== "DRAFT")
          fail(423, "Comments can only be edited on a draft report.");
        if (
          req.user.role === "TEACHER" &&
          b.principal_comment !== card.principal_comment
        )
          fail(403, "Teachers cannot change the principal comment.");
        await tx.query(
          "UPDATE report_cards SET teacher_comment=$1,principal_comment=$2 WHERE id=$3",
          [b.teacher_comment, b.principal_comment, rid],
        );
        await audit(
          tx,
          req.user,
          "report_cards",
          rid,
          "COMMENTS",
          {
            teacher_comment: card.teacher_comment,
            principal_comment: card.principal_comment,
          },
          b,
        );
      });
      ok(res, b);
    },
  );
  r.get(
    "/students/:id/scores",
    allow("academics.read", "reports.academic.own"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        tid = id.parse(req.query.term_id);
      if (["PARENT", "STUDENT"].includes(req.user.role)) {
        const c = await one(
          db,
          "SELECT rc.id FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id WHERE rc.school_id=$1 AND rc.student_id=$2 AND b.term_id=$3 AND b.status='PUBLISHED'",
          [req.user.school_id, sid, tid],
        );
        if (!c) fail(404, "Published results not found.");
        return ok(
          res,
          (await reportAccess(db, req.user, c.id)).snapshot.subjects,
        );
      }
      const s = await schoolRecord(db, req.user, "students", sid);
      if (!s.class_id) fail(404, "Student has no class.");
      await academicClass(db, req.user, s.class_id);
      ok(
        res,
        (await subjectResults(db, req.user, s.class_id, tid)).students.find(
          (s) => s.id === sid,
        )?.subjects || [],
      );
    },
  );
  r.get(
    "/analytics/academics",
    allow("analytics.read", "analytics.summary"),
    async (req, res) => {
      const filter = { term_id: id.parse(req.query.term_id) };
      for (const key of ["class_id", "subject_id", "teacher_user_id"])
        if (req.query[key]) filter[key] = id.parse(req.query[key]);
      if (filter.class_id) await academicClass(db, req.user, filter.class_id);
      ok(res, await academicAnalytics(db, req.user, filter));
    },
  );
  r.get(
    "/analytics/academics/at-risk",
    requirePermission("analytics.read"),
    async (req, res) => {
      const tid = id.parse(req.query.term_id);
      await schoolRecord(db, req.user, "terms", tid);
      ok(
        res,
        await rows(
          db,
          `SELECT f.*,s.first_name,s.last_name,c.name AS class_name FROM at_risk_flags f JOIN students s ON s.id=f.student_id JOIN classes c ON c.id=f.class_id WHERE f.school_id=$1 AND f.term_id=$2${req.user.role === "TEACHER" ? " AND c.teacher_user_id=$3" : ""} ORDER BY f.status,f.flagged_at DESC`,
          req.user.role === "TEACHER"
            ? [req.user.school_id, tid, req.user.id]
            : [req.user.school_id, tid],
        ),
      );
    },
  );
  r.patch(
    "/analytics/academics/at-risk/:id/resolve",
    requirePermission("analytics.read"),
    async (req, res) => {
      const fid = id.parse(req.params.id),
        note = text.parse(req.body.note),
        f = await schoolRecord(db, req.user, "at_risk_flags", fid);
      await academicClass(db, req.user, f.class_id, { homeroom: true });
      await db.query(
        "UPDATE at_risk_flags SET status='RESOLVED',resolution_note=$1,resolved_by=$2,resolved_at=now() WHERE id=$3",
        [note, req.user.id, fid],
      );
      await audit(db, req.user, "at_risk_flags", fid, "RESOLVE", f, { note });
      ok(res, { ok: true });
    },
  );

  r.get(
    "/curriculum/topics",
    requirePermission("curriculum.read"),
    async (req, res) =>
      ok(res, await curriculumRows(db, req.user, id.parse(req.query.term_id))),
  );
  async function validateTopic(tx, u, b) {
    const cs = await assignedSubject(tx, u, b.class_subject_id),
      term = await matchTerm(tx, u, cs.class_id, b.term_id);
    const weeks = Math.ceil(
      (Date.parse(term.end_date) - Date.parse(term.start_date) + 86400000) /
        604800000,
    );
    if (b.planned_week > weeks)
      fail(422, `Planned week exceeds this term's ${weeks} weeks.`);
    return cs;
  }
  r.post(
    "/curriculum/topics",
    requirePermission("curriculum.manage"),
    async (req, res) => {
      const b = topicSchema.parse(req.body);
      await validateTopic(db, req.user, b);
      const t = await insert(db, "curriculum_topics", {
        school_id: req.user.school_id,
        ...b,
      });
      await audit(db, req.user, "curriculum_topics", t.id, "CREATE", null, t);
      ok(res, t);
    },
  );
  r.patch(
    "/curriculum/topics/:id",
    requirePermission("curriculum.manage"),
    async (req, res) => {
      const tid = id.parse(req.params.id),
        b = topicSchema.parse(req.body),
        before = await schoolRecord(db, req.user, "curriculum_topics", tid);
      if (
        before.class_subject_id !== b.class_subject_id ||
        before.term_id !== b.term_id
      )
        fail(422, "A topic cannot move to another class subject or term.");
      await validateTopic(db, req.user, b);
      await db.query(
        "UPDATE curriculum_topics SET topic_name=$1,planned_week=$2,sequence_order=$3 WHERE id=$4",
        [b.topic_name, b.planned_week, b.sequence_order, tid],
      );
      await audit(db, req.user, "curriculum_topics", tid, "UPDATE", before, b);
      ok(res, b);
    },
  );
  r.post(
    "/curriculum/topics/import",
    requirePermission("curriculum.manage"),
    async (req, res) => {
      const b = z
        .object({
          class_subject_id: id,
          term_id: id,
          csv: z.string().max(100000),
        })
        .parse(req.body);
      const topics = parseTopicCsv(b.csv).map((row) =>
        topicSchema.parse({
          ...row,
          class_subject_id: b.class_subject_id,
          term_id: b.term_id,
        }),
      );
      await db.transaction(async (tx) => {
        for (const t of topics) {
          await validateTopic(tx, req.user, t);
          const row = await insert(tx, "curriculum_topics", {
            school_id: req.user.school_id,
            ...t,
          });
          await audit(
            tx,
            req.user,
            "curriculum_topics",
            row.id,
            "IMPORT",
            null,
            row,
          );
        }
      });
      ok(res, { imported: topics.length });
    },
  );
  r.post(
    "/curriculum/coverage-logs",
    requirePermission("curriculum.write"),
    async (req, res) => {
      const b = z
        .object({
          curriculum_topic_id: id,
          date_taught: date,
          lesson_duration_minutes: z.coerce.number().int().min(0).max(600),
          completion_status: z.enum(["COMPLETED", "PARTIAL", "NOT_STARTED"]),
          reason_for_noncompletion: optionalText,
        })
        .parse(req.body);
      const topic = await schoolRecord(
        db,
        req.user,
        "curriculum_topics",
        b.curriculum_topic_id,
      );
      await assignedSubject(db, req.user, topic.class_subject_id);
      const term = await schoolRecord(db, req.user, "terms", topic.term_id),
        today = localClock((await currentSchool(db, req.user)).timezone).date;
      if (
        b.date_taught < term.start_date ||
        b.date_taught > term.end_date ||
        b.date_taught > today
      )
        fail(
          422,
          "Teaching date must be within the term and cannot be in the future.",
        );
      if (
        b.completion_status !== "COMPLETED" &&
        !b.reason_for_noncompletion.trim()
      )
        fail(422, "Incomplete topics require a reason.");
      const l = await insert(db, "curriculum_coverage_logs", {
        school_id: req.user.school_id,
        ...b,
        logged_by: req.user.id,
      });
      await audit(
        db,
        req.user,
        "curriculum_coverage_logs",
        l.id,
        "CREATE",
        null,
        l,
      );
      ok(res, l);
    },
  );
  r.get(
    "/curriculum/topics/:id/history",
    requirePermission("curriculum.read"),
    async (req, res) => {
      const t = await schoolRecord(
        db,
        req.user,
        "curriculum_topics",
        id.parse(req.params.id),
      );
      await assignedSubject(db, req.user, t.class_subject_id);
      ok(
        res,
        await rows(
          db,
          "SELECT l.*,u.name AS teacher_name FROM curriculum_coverage_logs l JOIN users u ON u.id=l.logged_by WHERE l.school_id=$1 AND l.curriculum_topic_id=$2 ORDER BY l.date_taught DESC,l.id DESC",
          [req.user.school_id, t.id],
        ),
      );
    },
  );
  r.get(
    "/curriculum/dashboard",
    allow("curriculum.read", "curriculum.summary"),
    async (req, res) => {
      let topics = await curriculumRows(
        db,
        req.user,
        id.parse(req.query.term_id),
      );
      for (const key of ["class_id", "subject_id", "teacher_user_id"])
        if (req.query[key])
          topics = topics.filter((t) => t[key] === id.parse(req.query[key]));
      ok(res, {
        subjects: groupCurriculum(topics),
        teachers: groupCurriculum(topics, "teacher_user_id"),
        departments: groupCurriculum(topics, "department"),
        summary: {
          planned: topics.length,
          completed: topics.filter((t) => t.completion_status === "COMPLETED")
            .length,
          behind: topics.filter((t) => t.behind).length,
          coverage_percent: topics.length
            ? round(
                (100 *
                  topics.filter((t) => t.completion_status === "COMPLETED")
                    .length) /
                  topics.length,
              )
            : null,
        },
      });
    },
  );
  r.get(
    "/academics/reports/:key",
    allow(
      "analytics.read",
      "analytics.summary",
      "curriculum.read",
      "curriculum.summary",
    ),
    async (req, res) => {
      const key = req.params.key,
        format = z
          .enum(["csv", "xlsx", "pdf"])
          .parse(req.query.format || "csv"),
        tid = id.parse(req.query.term_id);
      let data;
      if (key === "curriculum") {
        if (
          !permitted(req.user, "curriculum.read") &&
          !permitted(req.user, "curriculum.summary")
        )
          fail(403, "Curriculum access required.");
        data = groupCurriculum(await curriculumRows(db, req.user, tid)).map(
          (g) => ({
            class: g.class_name,
            subject: g.subject_name,
            teacher: g.teacher_name,
            planned: g.planned,
            completed: g.completed,
            coverage_percent: g.coverage_percent,
            behind: g.behind,
          }),
        );
      } else {
        if (!["classes", "subjects", "teachers"].includes(key))
          fail(404, "Report not found.");
        if (
          !permitted(req.user, "analytics.read") &&
          !permitted(req.user, "analytics.summary")
        )
          fail(403, "Academic analytics access required.");
        const report = await academicAnalytics(db, req.user, { term_id: tid });
        data = report[key].map((g) => ({
          name: g[
            key === "classes"
              ? "class_name"
              : key === "subjects"
                ? "subject_name"
                : "teacher_name"
          ],
          completed: g.completed,
          incomplete: g.incomplete,
          average: g.average,
          pass_rate: g.pass_rate,
        }));
      }
      await audit(db, req.user, "academic_reports", tid, "EXPORT", null, {
        key,
        format,
      });
      if (!data.length)
        data = [{ message: "No records for the selected term." }];
      const columns = Object.keys(data[0]);
      res.attachment(`smpis-${key}-term-${tid}.${format}`);
      if (format === "csv") {
        const escape = (value) =>
          '"' +
          String(value ?? "")
            .replace(/^[=+\-@\t\r]/, "'$&")
            .replaceAll('"', '""') +
          '"';
        res
          .type("text/csv")
          .send(
            "\uFEFF" +
              [columns, ...data.map((row) => columns.map((c) => row[c]))]
                .map((row) => row.map(escape).join(","))
                .join("\r\n"),
          );
      } else if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook(),
          sheet = workbook.addWorksheet("Academic report");
        sheet.columns = columns.map((c) => ({ header: c, key: c, width: 24 }));
        data.forEach((row) => sheet.addRow(row));
        sheet.getRow(1).font = { bold: true };
        res.type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        await workbook.xlsx.write(res);
        res.end();
      } else {
        const school = await currentSchool(db, req.user),
          doc = new PDFDocument({
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
          .text(`${key.toUpperCase()} / Term ${tid}`)
          .moveDown();
        for (const row of data) {
          if (doc.y > 520) doc.addPage();
          doc
            .fontSize(10)
            .text(columns.map((c) => `${c}: ${row[c] ?? "—"}`).join("  |  "))
            .moveDown();
        }
        doc.end();
      }
    },
  );
  r.get(
    "/academics/overview",
    allow("analytics.read", "analytics.summary"),
    async (req, res) => {
      const tid = id.parse(req.query.term_id),
        analysis = await academicAnalytics(db, req.user, { term_id: tid }),
        topics = await curriculumRows(db, req.user, tid);
      const risk = await one(
        db,
        `SELECT count(DISTINCT f.student_id)::int AS students FROM at_risk_flags f JOIN classes c ON c.id=f.class_id WHERE f.school_id=$1 AND f.term_id=$2 AND f.status='OPEN'${req.user.role === "TEACHER" ? " AND c.teacher_user_id=$3" : ""}`,
        req.user.role === "TEACHER"
          ? [req.user.school_id, tid, req.user.id]
          : [req.user.school_id, tid],
      );
      ok(res, {
        ...analysis.summary,
        at_risk: risk.students,
        curriculum_percent: topics.length
          ? round(
              (100 *
                topics.filter((t) => t.completion_status === "COMPLETED")
                  .length) /
                topics.length,
            )
          : null,
        behind_topics: topics.filter((t) => t.behind).length,
      });
    },
  );
  return r;
}
