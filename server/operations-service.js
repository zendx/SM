import { one, rows, insert, audit } from "./db.js";
import { fail, permitted, localClock } from "./security.js";
import { schoolRecord, currentSchool, studentAccess } from "./services.js";
import { round, curriculumRows } from "./academic-service.js";

export const workflows = {
  DISCIPLINE: [
    "REPORTED",
    "REVIEWED",
    "INVESTIGATION",
    "PARENT_NOTIFICATION",
    "DECISION",
    "ACTION_TAKEN",
    "FOLLOW_UP",
    "CLOSED",
  ],
  COMPLAINT: [
    "SUBMITTED",
    "ACKNOWLEDGED",
    "ASSIGNED",
    "INVESTIGATED",
    "RESPONSE_PROVIDED",
    "RESOLVED",
    "PARENT_FEEDBACK",
  ],
  MAINTENANCE: [
    "REPORTED",
    "ASSIGNED",
    "IN_PROGRESS",
    "COMPLETED",
    "COST_RECORDED",
    "CLOSED",
  ],
};
export const categories = {
  DISCIPLINE: [
    "LATENESS",
    "BULLYING",
    "FIGHTING",
    "TRUANCY",
    "ACADEMIC_MISCONDUCT",
    "INSUBORDINATION",
    "PROPERTY_DAMAGE",
    "OTHER",
  ],
  COMPLAINT: [
    "ACADEMICS",
    "TEACHER",
    "FEES",
    "TRANSPORTATION",
    "BOARDING",
    "BULLYING",
    "FACILITIES",
    "COMMUNICATION",
    "OTHER",
  ],
  MAINTENANCE: ["REPAIR", "SERVICING", "REPLACEMENT", "SAFETY", "OTHER"],
};
export const disciplineActions = [
  "VERBAL_WARNING",
  "WRITTEN_WARNING",
  "COUNSELLING",
  "DETENTION",
  "PARENT_MEETING",
  "BEHAVIOUR_PLAN",
  "SUSPENSION",
];
export async function operationSettings(db, schoolId) {
  await db.query(
    "INSERT INTO operations_settings(school_id) VALUES($1) ON CONFLICT DO NOTHING",
    [schoolId],
  );
  return one(db, "SELECT * FROM operations_settings WHERE school_id=$1", [
    schoolId,
  ]);
}
export function canManageCase(u, c) {
  return (
    permitted(
      u,
      {
        DISCIPLINE: "discipline.manage",
        COMPLAINT: "complaints.manage",
        MAINTENANCE: "facilities.manage",
      }[c.kind],
    ) ||
    (c.kind === "COMPLAINT" && c.assigned_to === u.id)
  );
}
export async function caseAccess(db, u, cid, { lock = false } = {}) {
  const c = await one(
    db,
    `SELECT * FROM service_cases WHERE school_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [u.school_id, cid],
  );
  if (!c) fail(404, "Case not found.");
  if (canManageCase(u, c)) return c;
  if (c.kind === "COMPLAINT" && c.parent_user_id === u.id) return c;
  if (
    c.kind === "MAINTENANCE" &&
    c.created_by === u.id &&
    permitted(u, "operations.staff")
  )
    return c;
  if (c.kind === "DISCIPLINE" && permitted(u, "discipline.report")) {
    await studentAccess(db, u, c.student_id);
    return c;
  }
  fail(403, "This case is not available to your account.");
}
export async function notifyUser(db, schoolId, userId, title, body, key) {
  const user = await one(
    db,
    "SELECT id,email FROM users WHERE school_id=$1 AND id=$2 AND status='ACTIVE'",
    [schoolId, userId],
  );
  if (user)
    await db.query(
      "INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,dedupe_key) DO NOTHING",
      [schoolId, user.id, user.email, title, body, key],
    );
}
export async function refreshOperationAlerts(db, schoolId) {
  const settings = await operationSettings(db, schoolId),
    school = await one(db, "SELECT * FROM schools WHERE id=$1", [schoolId]);
  const today = localClock(school.timezone).date;
  const candidates = [];
  for (const r of await rows(
    db,
    "SELECT student_id,count(*)::int AS n FROM service_cases WHERE school_id=$1 AND kind='DISCIPLINE' AND event_date BETWEEN $2::date-($3::int-1) AND $2::date GROUP BY student_id HAVING count(*)>=$4",
    [
      schoolId,
      today,
      settings.discipline_window_days,
      settings.discipline_threshold,
    ],
  ))
    candidates.push([
      "DISCIPLINE",
      "HIGH",
      r.student_id,
      `${r.n} discipline incidents within ${settings.discipline_window_days} days.`,
    ]);
  for (const c of await rows(
    db,
    "SELECT id,kind,priority FROM service_cases WHERE school_id=$1 AND ((kind='COMPLAINT' AND due_at<now() AND stage NOT IN ('RESOLVED','PARENT_FEEDBACK')) OR (kind='MAINTENANCE' AND priority='URGENT' AND stage<>'CLOSED'))",
    [schoolId],
  ))
    candidates.push([
      c.kind === "COMPLAINT" ? "PARENT" : "FACILITIES",
      c.kind === "COMPLAINT" ? "HIGH" : "URGENT",
      c.id,
      c.kind === "COMPLAINT"
        ? `Complaint CASE-${c.id} is past its response target.`
        : `Urgent maintenance CASE-${c.id} needs attention.`,
    ]);
  for (const flag of await rows(
    db,
    "SELECT f.id,f.detail FROM at_risk_flags f JOIN terms t ON t.id=f.term_id WHERE f.school_id=$1 AND f.status='OPEN' AND t.is_current",
    [schoolId],
  ))
    candidates.push(["ACADEMIC", "HIGH", flag.id, flag.detail]);
  for (const term of await rows(
    db,
    "SELECT id FROM terms WHERE school_id=$1 AND is_current",
    [schoolId],
  ))
    for (const topic of await curriculumRows(
      db,
      { school_id: schoolId, role: "SUPER_ADMIN" },
      term.id,
    ))
      if (topic.behind)
        candidates.push([
          "CURRICULUM",
          "NORMAL",
          topic.id,
          `${topic.class_name} · ${topic.subject_name}: ${topic.topic_name} is behind its planned week.`,
        ]);
  for (const category of [
    "DISCIPLINE",
    "PARENT",
    "FACILITIES",
    "ACADEMIC",
    "CURRICULUM",
  ])
    await db.query(
      "UPDATE alerts SET status='RESOLVED',updated_at=now() WHERE school_id=$1 AND category=$2 AND NOT(entity_id=ANY($3::int[])) AND status<>'RESOLVED'",
      [
        schoolId,
        category,
        candidates.filter((c) => c[0] === category).map((c) => c[2]),
      ],
    );
  for (const [category, severity, entity, message] of candidates)
    await db.query(
      "INSERT INTO alerts(school_id,category,severity,entity_id,message) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,category,entity_id) DO UPDATE SET message=EXCLUDED.message,severity=EXCLUDED.severity,status=CASE WHEN alerts.status='RESOLVED' THEN 'ACTIVE' ELSE alerts.status END",
      [schoolId, category, severity, entity, message],
    );
}
export async function operationsSummary(db, u) {
  const cases = await one(
    db,
    "SELECT count(*) FILTER(WHERE kind='COMPLAINT' AND stage NOT IN ('RESOLVED','PARENT_FEEDBACK'))::int AS open_complaints,count(*) FILTER(WHERE kind='DISCIPLINE')::int AS discipline_incidents,count(*) FILTER(WHERE kind='MAINTENANCE' AND stage<>'CLOSED')::int AS maintenance_open,count(*) FILTER(WHERE kind='MAINTENANCE' AND priority='URGENT' AND stage<>'CLOSED')::int AS urgent_repairs,round(avg(EXTRACT(EPOCH FROM (resolved_at-created_at))/3600) FILTER(WHERE kind='COMPLAINT'),1) AS resolution_hours FROM service_cases WHERE school_id=$1",
    [u.school_id],
  );
  const surveys = await rows(
    db,
    "SELECT answers FROM survey_responses WHERE school_id=$1",
    [u.school_id],
  );
  const answers = surveys.flatMap((r) => r.answers);
  return {
    ...cases,
    satisfaction_score: answers.length
      ? round(answers.reduce((a, b) => a + b, 0) / answers.length)
      : null,
    survey_responses: surveys.length,
    ...(await one(
      db,
      "SELECT count(*) FILTER(WHERE condition='GOOD')::int AS facilities_good,count(*)::int AS facilities_total FROM facilities WHERE school_id=$1",
      [u.school_id],
    )),
    ...(await one(
      db,
      "SELECT count(*)::int AS staff_vacancies FROM vacancies WHERE school_id=$1 AND status='OPEN'",
      [u.school_id],
    )),
    ...(await one(
      db,
      "SELECT coalesce(sum(cost_cents),0) AS maintenance_cost_cents FROM maintenance_history WHERE school_id=$1",
      [u.school_id],
    )),
  };
}
export async function reviewSnapshot(db, u, staffId, yearId, development) {
  const staff = await schoolRecord(db, u, "staff", staffId),
    year = await schoolRecord(db, u, "academic_years", yearId),
    settings = await operationSettings(db, u.school_id);
  const a = await one(
    db,
    "SELECT count(*) FILTER(WHERE status<>'LEAVE')::int AS records,count(*) FILTER(WHERE status IN ('PRESENT','LATE'))::int AS present,count(*) FILTER(WHERE status='PRESENT')::int AS punctual FROM staff_attendance WHERE school_id=$1 AND staff_id=$2 AND attendance_date BETWEEN $3 AND $4",
    [u.school_id, staffId, year.start_date, year.end_date],
  );
  const topics = await rows(
    db,
    "SELECT t.id,(SELECT l.completion_status FROM curriculum_coverage_logs l WHERE l.curriculum_topic_id=t.id ORDER BY l.date_taught DESC,l.id DESC LIMIT 1) AS status FROM curriculum_topics t JOIN class_subjects cs ON cs.id=t.class_subject_id JOIN terms tm ON tm.id=t.term_id WHERE t.school_id=$1 AND cs.teacher_user_id=$2 AND tm.academic_year_id=$3",
    [u.school_id, staff.user_id, yearId],
  );
  const metrics = {
    attendance: a.records ? round((a.present / a.records) * 100) : null,
    punctuality: a.present ? round((a.punctual / a.present) * 100) : null,
    curriculum: topics.length
      ? round(
          (topics.filter((t) => t.status === "COMPLETED").length /
            topics.length) *
            100,
        )
      : null,
    development,
  };
  let numerator = 0,
    denominator = 0;
  for (const [key, value] of Object.entries(metrics))
    if (value !== null) {
      numerator += value * settings.review_weights[key];
      denominator += settings.review_weights[key];
    }
  return {
    metrics,
    weights: settings.review_weights,
    overall: denominator ? round(numerator / denominator) : null,
    attendance_records: a.records,
    curriculum_topics: topics.length,
    missing_metrics: Object.keys(metrics).filter((k) => metrics[k] === null),
    rule: "Missing measures are excluded and available weights renormalized.",
  };
}
