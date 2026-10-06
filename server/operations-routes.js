import express from "express";
import { one, rows, insert, audit } from "./db.js";
import {
  fail,
  permitted,
  requirePermission,
  localClock,
  cents,
  token,
} from "./security.js";
import { z, id, date, text, email, optionalText } from "./validation.js";
import {
  schoolRecord,
  currentSchool,
  studentAccess,
  studentScope,
  generateInvoice,
  classAccess,
} from "./services.js";
import {
  workflows,
  categories,
  disciplineActions,
  operationSettings,
  caseAccess,
  canManageCase,
  notifyUser,
  refreshOperationAlerts,
  operationsSummary,
  reviewSnapshot,
} from "./operations-service.js";
import { approveLeave } from "./history-service.js";
const note = z.string().trim().min(1).max(4000),
  optionalId = z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    id.nullable(),
  );
const ok = (res, data) => res.json({ data });
const allow =
  (...ps) =>
  (req, res, next) =>
    ps.some((p) => permitted(req.user, p))
      ? next()
      : next(
          Object.assign(
            new Error("This action is not available to your role."),
            { status: 403 },
          ),
        );
const isStaff = (u) => permitted(u, "operations.staff");
async function eligibleUser(db, u, uid, roles = null) {
  const v = await schoolRecord(db, u, "users", uid);
  if (v.status !== "ACTIVE" || (roles && !roles.includes(v.role)))
    fail(422, "Choose an active user in the required role.");
  return v;
}
async function today(db, u) {
  return localClock((await currentSchool(db, u)).timezone).date;
}
export function operationsRoutes(db) {
  const r = express.Router();
  r.get(
    "/operations/setup",
    allow("operations.staff", "experience.own", "operations.summary"),
    async (req, res) => {
      const u = req.user,
        scope = studentScope(u);
      const students =
        permitted(u, "discipline.report") ||
        permitted(u, "discipline.manage") ||
        u.role === "PARENT"
          ? await rows(
              db,
              `SELECT s.id,s.first_name,s.last_name,s.class_id FROM students s WHERE s.school_id=$1${scope.sql} ORDER BY s.last_name`,
              [u.school_id, ...scope.args],
            )
          : [];
      ok(res, {
        workflows,
        categories,
        disciplineActions,
        settings: await operationSettings(db, u.school_id),
        students,
        facilities: isStaff(u)
          ? await rows(
              db,
              "SELECT * FROM facilities WHERE school_id=$1 ORDER BY name",
              [u.school_id],
            )
          : [],
        assets: isStaff(u)
          ? await rows(
              db,
              "SELECT * FROM assets WHERE school_id=$1 ORDER BY asset_code",
              [u.school_id],
            )
          : [],
        users: isStaff(u)
          ? await rows(
              db,
              "SELECT id,name,role FROM users WHERE school_id=$1 AND status='ACTIVE' AND role NOT IN ('PARENT','STUDENT','PROPRIETOR') ORDER BY name",
              [u.school_id],
            )
          : [],
        parents: permitted(u, "complaints.manage")
          ? await rows(
              db,
              "SELECT id,name FROM users WHERE school_id=$1 AND role='PARENT' AND status='ACTIVE' ORDER BY name",
              [u.school_id],
            )
          : [],
        staff: permitted(u, "hr.manage")
          ? await rows(
              db,
              "SELECT s.*,p.supervisor_user_id,p.qualifications,p.certifications,p.employment_history,p.contract_notes,p.training FROM staff s LEFT JOIN staff_profiles p ON p.staff_id=s.id WHERE s.school_id=$1 ORDER BY s.last_name",
              [u.school_id],
            )
          : [],
      });
    },
  );
  r.patch(
    "/operations/settings",
    requirePermission("admin.write"),
    async (req, res) => {
      const b = z
        .object({
          complaint_sla_hours: z.coerce.number().int().min(1).max(720),
          discipline_threshold: z.coerce.number().int().min(2).max(100),
          discipline_window_days: z.coerce.number().int().min(1).max(365),
          review_weights: z.object({
            attendance: z.number().min(0).max(100),
            punctuality: z.number().min(0).max(100),
            curriculum: z.number().min(0).max(100),
            development: z.number().min(0).max(100),
          }),
        })
        .parse(req.body);
      if (Object.values(b.review_weights).reduce((a, v) => a + v, 0) !== 100)
        fail(422, "Review weights must total 100%.");
      const before = await operationSettings(db, req.user.school_id);
      await db.transaction(async (tx) => {
        await tx.query(
          "UPDATE operations_settings SET complaint_sla_hours=$2,discipline_threshold=$3,discipline_window_days=$4,review_weights=$5 WHERE school_id=$1",
          [
            req.user.school_id,
            b.complaint_sla_hours,
            b.discipline_threshold,
            b.discipline_window_days,
            JSON.stringify(b.review_weights),
          ],
        );
        await audit(
          tx,
          req.user,
          "operations_settings",
          req.user.school_id,
          "UPDATE",
          before,
          b,
        );
      });
      ok(res, b);
    },
  );
  r.get(
    "/operations/summary",
    requirePermission("operations.summary"),
    async (req, res) => ok(res, await operationsSummary(db, req.user)),
  );
  r.get(
    "/operations/cases",
    allow("operations.staff", "experience.own"),
    async (req, res) => {
      const kind = z
          .enum(["DISCIPLINE", "COMPLAINT", "MAINTENANCE"])
          .parse(req.query.kind),
        u = req.user;
      const all = await rows(
        db,
        "SELECT c.*,s.first_name,s.last_name,f.name AS facility_name,a.name AS assignee_name FROM service_cases c LEFT JOIN students s ON s.id=c.student_id LEFT JOIN facilities f ON f.id=c.facility_id LEFT JOIN users a ON a.id=c.assigned_to WHERE c.school_id=$1 AND c.kind=$2 ORDER BY c.created_at DESC",
        [u.school_id, kind],
      );
      const allowed = [];
      for (const c of all) {
        try {
          await caseAccess(db, u, c.id);
          allowed.push(c);
        } catch (e) {
          if (![403, 404].includes(e.status)) throw e;
        }
      }
      ok(res, allowed);
    },
  );
  r.post(
    "/operations/cases",
    allow("operations.staff", "experience.own"),
    async (req, res) => {
      const b = z
          .object({
            kind: z.enum(["DISCIPLINE", "COMPLAINT", "MAINTENANCE"]),
            category: text,
            description: note,
            event_date: date,
            priority: z
              .enum(["LOW", "NORMAL", "HIGH", "URGENT"])
              .default("NORMAL"),
            student_id: optionalId,
            facility_id: optionalId,
            asset_id: optionalId,
            parent_user_id: optionalId,
          })
          .parse(req.body),
        u = req.user;
      if (!categories[b.kind].includes(b.category))
        fail(422, "Choose a valid category.");
      if (b.event_date > (await today(db, u)))
        fail(422, "The event date cannot be in the future.");
      const result = await db.transaction(async (tx) => {
        let parent = null,
          assigned = null,
          due = null;
        if (b.kind === "DISCIPLINE") {
          if (
            !permitted(u, "discipline.report") &&
            !permitted(u, "discipline.manage")
          )
            fail(403, "You cannot report discipline incidents.");
          if (!b.student_id) fail(422, "Choose a student.");
          await studentAccess(tx, u, b.student_id);
        } else if (b.kind === "COMPLAINT") {
          if (u.role !== "PARENT" && !permitted(u, "complaints.manage"))
            fail(
              403,
              "Only a parent or school manager may submit a complaint.",
            );
          parent = u.role === "PARENT" ? u.id : b.parent_user_id;
          if (!parent) fail(422, "Choose the parent raising this complaint.");
          await eligibleUser(tx, u, parent, ["PARENT"]);
          if (b.student_id) {
            const s = await schoolRecord(tx, u, "students", b.student_id);
            if (s.parent_user_id !== parent)
              fail(422, "The selected student is not linked to this parent.");
          }
          const role =
            {
              FEES: "FINANCE_OFFICER",
              FACILITIES: "FACILITIES_MANAGER",
              TRANSPORTATION: "FACILITIES_MANAGER",
              BOARDING: "FACILITIES_MANAGER",
              ACADEMICS: "VICE_PRINCIPAL",
              TEACHER: "PRINCIPAL",
              BULLYING: "VICE_PRINCIPAL",
            }[b.category] || "PRINCIPAL";
          assigned =
            (
              await one(
                tx,
                "SELECT id FROM users WHERE school_id=$1 AND status='ACTIVE' AND role=$2 ORDER BY id LIMIT 1",
                [u.school_id, role],
              )
            )?.id || null;
          const settings = await operationSettings(tx, u.school_id);
          due = new Date(
            Date.now() + settings.complaint_sla_hours * 3600000,
          ).toISOString();
        } else {
          if (!isStaff(u)) fail(403, "Staff access required.");
          if (!b.facility_id) fail(422, "Choose a facility.");
          await schoolRecord(tx, u, "facilities", b.facility_id);
          if (
            b.asset_id &&
            (await schoolRecord(tx, u, "assets", b.asset_id)).facility_id !==
              b.facility_id
          )
            fail(422, "The asset must belong to this facility.");
        }
        const c = await insert(tx, "service_cases", {
          school_id: u.school_id,
          kind: b.kind,
          category: b.category,
          description: b.description,
          event_date: b.event_date,
          priority: b.priority,
          student_id: b.kind !== "MAINTENANCE" ? b.student_id : null,
          facility_id: b.kind === "MAINTENANCE" ? b.facility_id : null,
          asset_id: b.kind === "MAINTENANCE" ? b.asset_id : null,
          parent_user_id: parent,
          created_by: u.id,
          assigned_to: assigned,
          due_at: due,
          stage: workflows[b.kind][0],
        });
        await audit(tx, u, "service_cases", c.id, "CREATE", null, c);
        if (parent)
          await notifyUser(
            tx,
            u.school_id,
            parent,
            "Complaint received",
            `Your complaint CASE-${c.id} has been received. Target response: ${due}.`,
            `complaint-ack:${c.id}`,
          );
        if (assigned)
          await notifyUser(
            tx,
            u.school_id,
            assigned,
            "Complaint assigned",
            `Please review CASE-${c.id}.`,
            `complaint-assigned:${c.id}:${assigned}`,
          );
        if (b.kind === "MAINTENANCE" && b.priority === "URGENT")
          for (const m of await rows(
            tx,
            "SELECT id FROM users WHERE school_id=$1 AND role='FACILITIES_MANAGER' AND status='ACTIVE'",
            [u.school_id],
          ))
            await notifyUser(
              tx,
              u.school_id,
              m.id,
              "Urgent maintenance",
              `Urgent repair CASE-${c.id}: ${b.description}`,
              `urgent-maintenance:${c.id}:${m.id}`,
            );
        return c;
      });
      await refreshOperationAlerts(db, u.school_id);
      ok(res, result);
    },
  );
  r.get("/operations/cases/:id", async (req, res) => {
    const c = await caseAccess(db, req.user, id.parse(req.params.id));
    ok(res, {
      ...c,
      history: await rows(
        db,
        "SELECT a.*,u.name AS actor_name FROM case_actions a JOIN users u ON u.id=a.actor_id WHERE a.school_id=$1 AND a.case_id=$2 ORDER BY a.id",
        [req.user.school_id, c.id],
      ),
    });
  });
  r.patch("/operations/cases/:id/assign", async (req, res) => {
    const uid = id.parse(req.body.assigned_to);
    const c = await caseAccess(db, req.user, id.parse(req.params.id));
    const permission = {
      DISCIPLINE: "discipline.manage",
      COMPLAINT: "complaints.manage",
      MAINTENANCE: "facilities.manage",
    }[c.kind];
    if (!permitted(req.user, permission))
      fail(403, "Only the responsible manager may reassign a case.");
    const target = await eligibleUser(db, req.user, uid);
    if (["PARENT", "STUDENT", "PROPRIETOR"].includes(target.role))
      fail(422, "Choose a staff account.");
    await db.transaction(async (tx) => {
      await tx.query("UPDATE service_cases SET assigned_to=$1 WHERE id=$2", [
        uid,
        c.id,
      ]);
      await audit(tx, req.user, "service_cases", c.id, "ASSIGN", null, {
        assigned_to: uid,
      });
      await notifyUser(
        tx,
        req.user.school_id,
        uid,
        "Case assigned",
        `Please review CASE-${c.id}.`,
        `case-assigned:${c.id}:${uid}`,
      );
    });
    ok(res, { ok: true });
  });
  r.post("/operations/cases/:id/stage", async (req, res) => {
    const b = z
        .object({
          stage: text,
          note,
          action_type: optionalText,
          cost: optionalText,
          feedback_score: z.coerce.number().int().min(1).max(5).optional(),
        })
        .parse(req.body),
      u = req.user;
    await db.transaction(async (tx) => {
      const c = await caseAccess(tx, u, id.parse(req.params.id), {
          lock: true,
        }),
        feedback = c.kind === "COMPLAINT" && b.stage === "PARENT_FEEDBACK";
      if (feedback ? c.parent_user_id !== u.id : !canManageCase(u, c))
        fail(403, "Your account cannot advance this case.");
      if (workflows[c.kind][workflows[c.kind].indexOf(c.stage) + 1] !== b.stage)
        fail(409, "Advance one workflow stage at a time.");
      let cost = c.cost_cents,
        action = c.action_type,
        notified = c.parent_notified_at;
      if (b.stage === "ASSIGNED" && !c.assigned_to)
        fail(422, "Assign a responsible staff member first.");
      if (c.kind === "DISCIPLINE" && b.stage === "PARENT_NOTIFICATION")
        notified = new Date().toISOString();
      if (c.kind === "DISCIPLINE" && b.stage === "ACTION_TAKEN") {
        if (!disciplineActions.includes(b.action_type))
          fail(422, "Choose a disciplinary action.");
        action = b.action_type;
      }
      if (c.kind === "MAINTENANCE" && b.stage === "COST_RECORDED") {
        if (b.cost === "")
          fail(422, "Record a cost, including zero for no charge.");
        cost = cents(b.cost);
      }
      if (c.kind === "MAINTENANCE" && b.stage === "CLOSED" && cost === null)
        fail(422, "Record the repair cost before closing.");
      if (feedback && !b.feedback_score) fail(422, "Select a feedback rating.");
      await tx.query(
        "UPDATE service_cases SET stage=$2,action_type=$3,parent_notified_at=$4,cost_cents=$5,follow_up=CASE WHEN $2='CLOSED' THEN $6 ELSE follow_up END,resolved_at=CASE WHEN $2 IN ('CLOSED','RESOLVED') THEN now() ELSE resolved_at END,feedback_score=coalesce($7,feedback_score),feedback_note=CASE WHEN $2='PARENT_FEEDBACK' THEN $6 ELSE feedback_note END WHERE id=$1",
        [
          c.id,
          b.stage,
          action,
          notified,
          cost,
          b.note,
          b.feedback_score || null,
        ],
      );
      await insert(tx, "case_actions", {
        school_id: u.school_id,
        case_id: c.id,
        actor_id: u.id,
        from_stage: c.stage,
        to_stage: b.stage,
        note: b.note,
      });
      if (c.kind === "MAINTENANCE" && b.stage === "CLOSED")
        await insert(tx, "maintenance_history", {
          school_id: u.school_id,
          case_id: c.id,
          cost_cents: cost,
          closed_by: u.id,
        });
      if (
        c.kind === "COMPLAINT" &&
        ["RESPONSE_PROVIDED", "RESOLVED"].includes(b.stage)
      )
        await notifyUser(
          tx,
          u.school_id,
          c.parent_user_id,
          `Complaint CASE-${c.id} updated`,
          b.note,
          `case-stage:${c.id}:${b.stage}`,
        );
      await audit(
        tx,
        u,
        "service_cases",
        c.id,
        "STAGE",
        { stage: c.stage },
        { stage: b.stage, note: b.note },
      );
    });
    await refreshOperationAlerts(db, u.school_id);
    ok(res, { ok: true });
  });
  r.get(
    "/operations/discipline/repeated",
    requirePermission("discipline.manage"),
    async (req, res) => {
      const from = date.parse(req.query.from),
        to = date.parse(req.query.to);
      if (to < from) fail(422, "Choose an ordered date range.");
      const category = req.query.category || null;
      if (category && !categories.DISCIPLINE.includes(category))
        fail(422, "Invalid category.");
      ok(
        res,
        await rows(
          db,
          "SELECT s.id,s.first_name,s.last_name,count(*)::int AS incidents FROM service_cases c JOIN students s ON s.id=c.student_id WHERE c.school_id=$1 AND c.kind='DISCIPLINE' AND c.event_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR c.category=$4) GROUP BY s.id HAVING count(*)>=2 ORDER BY incidents DESC",
          [req.user.school_id, from, to, category],
        ),
      );
    },
  );
  r.get(
    "/surveys",
    allow("experience.own", "complaints.manage", "operations.summary"),
    async (req, res) => {
      const u = req.user;
      ok(
        res,
        await rows(
          db,
          `SELECT s.*,EXISTS(SELECT 1 FROM survey_responses r WHERE r.survey_id=s.id AND r.parent_user_id=$2) AS responded FROM satisfaction_surveys s WHERE school_id=$1${u.role === "PARENT" ? " AND published" : ""} ORDER BY id DESC`,
          [u.school_id, u.id],
        ),
      );
    },
  );
  r.post(
    "/surveys",
    requirePermission("complaints.manage"),
    async (req, res) => {
      const b = z
        .object({
          title: text,
          questions: z.array(text).min(1).max(20),
          start_date: date,
          end_date: date,
          published: z.boolean().default(false),
        })
        .parse(req.body);
      if (b.end_date < b.start_date)
        fail(422, "End date must follow start date.");
      const survey = await insert(db, "satisfaction_surveys", {
        school_id: req.user.school_id,
        ...b,
        questions: JSON.stringify(b.questions),
      });
      await audit(db, req.user, "satisfaction_surveys", survey.id, "CREATE");
      ok(res, survey);
    },
  );
  r.post(
    "/surveys/:id/responses",
    requirePermission("experience.own"),
    async (req, res) => {
      const b = z
          .array(z.number().int().min(1).max(5))
          .min(1)
          .max(20)
          .parse(req.body.answers),
        survey = await schoolRecord(
          db,
          req.user,
          "satisfaction_surveys",
          id.parse(req.params.id),
        ),
        now = await today(db, req.user);
      if (req.user.role !== "PARENT")
        fail(403, "Only parent accounts can submit survey responses.");
      if (!survey.published || now < survey.start_date || now > survey.end_date)
        fail(422, "This survey is not open.");
      if (b.length !== survey.questions.length)
        fail(422, "Answer every survey question.");
      if (
        await one(
          db,
          "SELECT id FROM survey_responses WHERE survey_id=$1 AND parent_user_id=$2",
          [survey.id, req.user.id],
        )
      )
        fail(409, "You have already answered this survey.");
      ok(
        res,
        await insert(db, "survey_responses", {
          school_id: req.user.school_id,
          survey_id: survey.id,
          parent_user_id: req.user.id,
          answers: JSON.stringify(b),
        }),
      );
    },
  );
  r.get(
    "/surveys/:id/results",
    allow("complaints.manage", "operations.summary"),
    async (req, res) => {
      const s = await schoolRecord(
          db,
          req.user,
          "satisfaction_surveys",
          id.parse(req.params.id),
        ),
        responses = await rows(
          db,
          "SELECT answers FROM survey_responses WHERE school_id=$1 AND survey_id=$2",
          [req.user.school_id, s.id],
        );
      ok(res, {
        title: s.title,
        responses: responses.length,
        questions: s.questions.map((q, i) => ({
          question: q,
          average: responses.length
            ? Math.round(
                (responses.reduce((n, r) => n + r.answers[i], 0) /
                  responses.length) *
                  100,
              ) / 100
            : null,
        })),
      });
    },
  );
  for (const [path, table, schema] of [
    [
      "facilities",
      "facilities",
      z.object({
        name: text,
        category: text,
        location: text,
        condition: z.enum(["GOOD", "FAIR", "POOR", "OUT_OF_SERVICE"]),
        responsible_user_id: optionalId,
      }),
    ],
    [
      "assets",
      "assets",
      z.object({
        facility_id: id,
        asset_code: text,
        description: note,
        purchase_date: date,
        purchase_value: z.string(),
        condition: z.enum(["GOOD", "FAIR", "POOR", "OUT_OF_SERVICE"]),
        responsible_user_id: optionalId,
      }),
    ],
  ]) {
    r.post(
      "/" + path,
      requirePermission("facilities.manage"),
      async (req, res) => {
        const b = schema.parse(req.body);
        if (b.responsible_user_id)
          await eligibleUser(db, req.user, b.responsible_user_id);
        if (table === "assets") {
          await schoolRecord(db, req.user, "facilities", b.facility_id);
          b.purchase_value_cents = cents(b.purchase_value);
          delete b.purchase_value;
        }
        const record = await insert(db, table, {
          school_id: req.user.school_id,
          ...b,
        });
        await audit(db, req.user, table, record.id, "CREATE", null, record);
        ok(res, record);
      },
    );
    r.patch(
      "/" + path + "/:id",
      requirePermission("facilities.manage"),
      async (req, res) => {
        const b = z
            .object({
              condition: z.enum(["GOOD", "FAIR", "POOR", "OUT_OF_SERVICE"]),
            })
            .parse(req.body),
          record = await schoolRecord(
            db,
            req.user,
            table,
            id.parse(req.params.id),
          );
        await db.query(`UPDATE ${table} SET condition=$1 WHERE id=$2`, [
          b.condition,
          record.id,
        ]);
        await audit(db, req.user, table, record.id, "CONDITION", record, b);
        ok(res, b);
      },
    );
  }
  r.get(
    "/hr/overview",
    requirePermission("operations.staff"),
    async (req, res) => {
      const u = req.user,
        manage = permitted(u, "hr.manage");
      ok(res, {
        vacancies: manage
          ? await rows(
              db,
              "SELECT * FROM vacancies WHERE school_id=$1 ORDER BY id DESC",
              [u.school_id],
            )
          : [],
        applicants: manage
          ? await rows(
              db,
              "SELECT a.*,v.title FROM job_applicants a JOIN vacancies v ON v.id=a.vacancy_id WHERE a.school_id=$1 ORDER BY a.id DESC",
              [u.school_id],
            )
          : [],
        leave: await rows(
          db,
          `SELECT l.*,s.first_name,s.last_name,s.user_id FROM leave_requests l JOIN staff s ON s.id=l.staff_id WHERE l.school_id=$1${manage ? "" : " AND (s.user_id=$2 OR l.supervisor_user_id=$2)"} ORDER BY l.id DESC`,
          manage ? [u.school_id] : [u.school_id, u.id],
        ),
        reviews: manage
          ? await rows(
              db,
              "SELECT r.*,s.first_name,s.last_name,y.name AS year_name FROM performance_reviews r JOIN staff s ON s.id=r.staff_id JOIN academic_years y ON y.id=r.academic_year_id WHERE r.school_id=$1 ORDER BY y.start_date DESC,s.last_name",
              [u.school_id],
            )
          : [],
        self:
          (await one(
            db,
            "SELECT s.id,s.first_name,s.last_name,p.supervisor_user_id FROM staff s LEFT JOIN staff_profiles p ON p.staff_id=s.id WHERE s.school_id=$1 AND s.user_id=$2",
            [u.school_id, u.id],
          )) || null,
      });
    },
  );
  r.patch(
    "/hr/staff/:id/profile",
    requirePermission("hr.manage"),
    async (req, res) => {
      const sid = id.parse(req.params.id),
        s = await schoolRecord(db, req.user, "staff", sid),
        b = z
          .object({
            supervisor_user_id: optionalId,
            qualifications: optionalText,
            certifications: optionalText,
            employment_history: optionalText,
            contract_notes: optionalText,
            training: optionalText,
          })
          .parse(req.body);
      if (b.supervisor_user_id) {
        const sup = await eligibleUser(db, req.user, b.supervisor_user_id);
        if (
          ["PARENT", "STUDENT", "PROPRIETOR"].includes(sup.role) ||
          sup.id === s.user_id
        )
          fail(422, "Choose another staff account as supervisor.");
      }
      await db.query(
        "INSERT INTO staff_profiles(staff_id,school_id,supervisor_user_id,qualifications,certifications,employment_history,contract_notes,training) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(staff_id) DO UPDATE SET supervisor_user_id=EXCLUDED.supervisor_user_id,qualifications=EXCLUDED.qualifications,certifications=EXCLUDED.certifications,employment_history=EXCLUDED.employment_history,contract_notes=EXCLUDED.contract_notes,training=EXCLUDED.training",
        [sid, req.user.school_id, ...Object.values(b)],
      );
      await audit(db, req.user, "staff_profiles", sid, "UPDATE", null, b);
      ok(res, b);
    },
  );
  r.post("/hr/vacancies", requirePermission("hr.manage"), async (req, res) => {
    const b = z
      .object({
        title: text,
        department: text,
        description: note,
        closing_date: date,
      })
      .parse(req.body);
    const v = await insert(db, "vacancies", {
      school_id: req.user.school_id,
      ...b,
    });
    await audit(db, req.user, "vacancies", v.id, "CREATE");
    ok(res, v);
  });
  r.patch(
    "/hr/vacancies/:id",
    requirePermission("hr.manage"),
    async (req, res) => {
      const v = await schoolRecord(
          db,
          req.user,
          "vacancies",
          id.parse(req.params.id),
        ),
        status = z.enum(["OPEN", "CLOSED"]).parse(req.body.status);
      await db.query("UPDATE vacancies SET status=$1 WHERE id=$2", [
        status,
        v.id,
      ]);
      await audit(db, req.user, "vacancies", v.id, "STATUS", v, { status });
      ok(res, { status });
    },
  );
  r.post("/hr/applicants", requirePermission("hr.manage"), async (req, res) => {
    const b = z
        .object({
          vacancy_id: id,
          first_name: text,
          last_name: text,
          email,
          phone: text,
          qualifications: note,
        })
        .parse(req.body),
      v = await schoolRecord(db, req.user, "vacancies", b.vacancy_id);
    if (v.status !== "OPEN" || v.closing_date < (await today(db, req.user)))
      fail(422, "The vacancy is closed.");
    const a = await insert(db, "job_applicants", {
      school_id: req.user.school_id,
      ...b,
    });
    await audit(db, req.user, "job_applicants", a.id, "CREATE");
    ok(res, a);
  });
  r.get(
    "/hr/applicants/:id/history",
    requirePermission("hr.manage"),
    async (req, res) => {
      const a = await schoolRecord(
        db,
        req.user,
        "job_applicants",
        id.parse(req.params.id),
      );
      ok(
        res,
        await rows(
          db,
          "SELECT * FROM recruitment_history WHERE school_id=$1 AND applicant_id=$2 ORDER BY id",
          [req.user.school_id, a.id],
        ),
      );
    },
  );
  r.post(
    "/hr/applicants/:id/stage",
    requirePermission("hr.manage"),
    async (req, res) => {
      const b = z
        .object({
          stage: z.enum([
            "SHORTLISTED",
            "INTERVIEW",
            "OFFERED",
            "HIRED",
            "REJECTED",
          ]),
          note,
          interview_at: z.string().optional(),
          hire_date: date.optional(),
        })
        .parse(req.body);
      await db.transaction(async (tx) => {
        const a = await one(
          tx,
          "SELECT * FROM job_applicants WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [req.user.school_id, id.parse(req.params.id)],
        );
        if (!a) fail(404, "Applicant not found.");
        const sequence = [
          "APPLIED",
          "SHORTLISTED",
          "INTERVIEW",
          "OFFERED",
          "HIRED",
        ];
        if (
          ["HIRED", "REJECTED"].includes(a.stage) ||
          (b.stage !== "REJECTED" &&
            sequence[sequence.indexOf(a.stage) + 1] !== b.stage)
        )
          fail(409, "Invalid recruitment stage transition.");
        let interview = a.interview_at,
          sid = a.staff_id;
        if (b.stage === "INTERVIEW") {
          if (!b.interview_at || !Number.isFinite(Date.parse(b.interview_at)))
            fail(422, "Enter an interview date and time.");
          interview = new Date(b.interview_at).toISOString();
        }
        if (b.stage === "HIRED") {
          if (!b.hire_date) fail(422, "Enter the hire date.");
          const v = await schoolRecord(tx, req.user, "vacancies", a.vacancy_id);
          sid = (
            await insert(tx, "staff", {
              school_id: req.user.school_id,
              staff_number: `STF-${token().slice(0, 10).toUpperCase()}`,
              first_name: a.first_name,
              last_name: a.last_name,
              department: v.department,
              position: v.title,
              hire_date: b.hire_date,
            })
          ).id;
          await insert(tx, "staff_profiles", {
            school_id: req.user.school_id,
            staff_id: sid,
            qualifications: a.qualifications,
          });
        }
        await tx.query(
          "UPDATE job_applicants SET stage=$2,interview_at=$3,evaluation=$4,staff_id=$5 WHERE id=$1",
          [a.id, b.stage, interview, b.note, sid],
        );
        await insert(tx, "recruitment_history", {
          school_id: req.user.school_id,
          applicant_id: a.id,
          stage: b.stage,
          note: b.note,
          actor_id: req.user.id,
        });
        await audit(
          tx,
          req.user,
          "job_applicants",
          a.id,
          "STAGE",
          { stage: a.stage },
          { stage: b.stage, staff_id: sid },
        );
      });
      ok(res, { ok: true });
    },
  );
  r.post(
    "/hr/leave",
    requirePermission("operations.staff"),
    async (req, res) => {
      const b = z
        .object({ start_date: date, end_date: date, reason: note })
        .parse(req.body);
      if (
        b.end_date < b.start_date ||
        (Date.parse(b.end_date) - Date.parse(b.start_date)) / 86400000 > 365
      )
        fail(422, "Leave must cover an ordered range of at most 366 days.");
      const u = req.user;
      const result = await db.transaction(async (tx) => {
        const s = await one(
          tx,
          "SELECT * FROM staff WHERE school_id=$1 AND user_id=$2 AND status='ACTIVE' FOR UPDATE",
          [u.school_id, u.id],
        );
        if (!s)
          fail(422, "HR must link an active staff record to your account.");
        const p = await one(
          tx,
          "SELECT * FROM staff_profiles WHERE staff_id=$1",
          [s.id],
        );
        if (!p?.supervisor_user_id)
          fail(422, "HR must assign your supervisor first.");
        await eligibleUser(tx, u, p.supervisor_user_id);
        if (
          await one(
            tx,
            "SELECT id FROM leave_requests WHERE staff_id=$1 AND status<>'REJECTED' AND cancelled_at IS NULL AND start_date<=$3 AND end_date>=$2",
            [s.id, b.start_date, b.end_date],
          )
        )
          fail(409, "This overlaps an existing leave request.");
        const l = await insert(tx, "leave_requests", {
          school_id: u.school_id,
          staff_id: s.id,
          supervisor_user_id: p.supervisor_user_id,
          ...b,
        });
        await notifyUser(
          tx,
          u.school_id,
          p.supervisor_user_id,
          "Leave review requested",
          `Please review leave request ${l.id}.`,
          `leave:${l.id}`,
        );
        await audit(tx, u, "leave_requests", l.id, "CREATE");
        return l;
      });
      ok(res, result);
    },
  );
  r.post(
    "/hr/leave/:id/decision",
    requirePermission("operations.staff"),
    async (req, res) => {
      const b = z
          .object({
            status: z.enum(["REVIEWED", "APPROVED", "REJECTED"]),
            note,
          })
          .parse(req.body),
        u = req.user;
      await db.transaction(async (tx) => {
        const l = await one(
          tx,
          "SELECT * FROM leave_requests WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [u.school_id, id.parse(req.params.id)],
        );
        if (!l) fail(404, "Leave request not found.");
        const s = await one(
          tx,
          "SELECT * FROM staff WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [u.school_id, l.staff_id],
        );
        if (s.user_id === u.id)
          fail(403, "You cannot approve or review your own leave.");
        if (
          b.status === "REVIEWED"
            ? l.supervisor_user_id !== u.id
            : !permitted(u, "hr.manage")
        )
          fail(
            403,
            "Supervisor review and HR decisions use separate permissions.",
          );
        if (
          l.cancelled_at ||
          ["APPROVED", "REJECTED"].includes(l.status) ||
          (b.status === "REVIEWED" && l.status !== "REQUESTED") ||
          (b.status === "APPROVED" && l.status !== "REVIEWED")
        )
          fail(409, "This leave request is not at the required stage.");
        if (b.status === "APPROVED") await approveLeave(tx, u, l);
        await tx.query(
          "UPDATE leave_requests SET status=$2,decision_note=$3,decided_by=$4 WHERE id=$1",
          [l.id, b.status, b.note, u.id],
        );
        await audit(
          tx,
          u,
          "leave_requests",
          l.id,
          b.status,
          { status: l.status },
          { note: b.note },
        );
        await notifyUser(
          tx,
          u.school_id,
          s.user_id,
          "Leave request updated",
          `Request ${l.id}: ${b.status}. ${b.note}`,
          `leave:${l.id}:${b.status}`,
        );
      });
      ok(res, { ok: true });
    },
  );
  r.post("/hr/reviews", requirePermission("hr.manage"), async (req, res) => {
    const b = z
      .object({
        staff_id: id,
        academic_year_id: id,
        development_score: z.coerce.number().min(0).max(100),
        notes: note,
      })
      .parse(req.body);
    const snapshot = await reviewSnapshot(
      db,
      req.user,
      b.staff_id,
      b.academic_year_id,
      b.development_score,
    );
    const review = await insert(db, "performance_reviews", {
      school_id: req.user.school_id,
      ...b,
      overall_score: snapshot.overall,
      snapshot: JSON.stringify(snapshot),
      reviewed_by: req.user.id,
    });
    await audit(db, req.user, "performance_reviews", review.id, "CREATE");
    ok(res, review);
  });
  r.post(
    "/finance/invoices/batch",
    requirePermission("finance.write"),
    async (req, res) => {
      const b = z
        .object({ class_id: id, term_id: id, due_date: date })
        .parse(req.body);
      await classAccess(db, req.user, b.class_id);
      const students = await rows(
        db,
        "SELECT id FROM students WHERE school_id=$1 AND class_id=$2 AND status='ENROLLED' ORDER BY id",
        [req.user.school_id, b.class_id],
      );
      const results = [];
      for (const s of students) {
        try {
          const invoice = await generateInvoice(db, req.user, {
            student_id: s.id,
            term_id: b.term_id,
            due_date: b.due_date,
          });
          results.push({ student_id: s.id, invoice_id: invoice.id });
        } catch (e) {
          if (!e.status) throw e;
          results.push({ student_id: s.id, error: e.message });
        }
      }
      await audit(db, req.user, "classes", b.class_id, "BATCH_INVOICES", null, {
        term_id: b.term_id,
        success: results.filter((r) => r.invoice_id).length,
        failed: results.filter((r) => r.error).length,
      });
      ok(res, results);
    },
  );
  return r;
}
