import { one, rows, insert, audit } from "./db.js";
import { fail, localClock, permitted } from "./security.js";
import { schoolRecord, currentSchool } from "./services.js";
import { termRoster } from "./history-service.js";

export const round = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export async function academicPolicy(db, schoolId) {
  await db.query(
    "INSERT INTO academic_settings(school_id) VALUES($1) ON CONFLICT DO NOTHING",
    [schoolId],
  );
  return one(db, "SELECT * FROM academic_settings WHERE school_id=$1", [
    schoolId,
  ]);
}
export function grade(percent, policy) {
  return policy.grading_scale.find((g) => percent >= Number(g.minimum));
}
export async function academicClass(
  db,
  u,
  classId,
  { homeroom = false, lock = false } = {},
) {
  const c = await one(
    db,
    `SELECT * FROM classes WHERE school_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [u.school_id, classId],
  );
  if (!c) fail(404, "Class not found.");
  if (
    u.role === "TEACHER" &&
    c.teacher_user_id !== u.id &&
    (homeroom ||
      !(await one(
        db,
        "SELECT id FROM class_subjects WHERE school_id=$1 AND class_id=$2 AND teacher_user_id=$3",
        [u.school_id, classId, u.id],
      )))
  )
    fail(403, "This class is not assigned to you.");
  return c;
}
export async function assignedSubject(db, u, csId) {
  const cs = await schoolRecord(db, u, "class_subjects", csId);
  if (u.role === "TEACHER" && cs.teacher_user_id !== u.id)
    fail(403, "This subject is not assigned to you.");
  return cs;
}
export async function matchTerm(db, u, classId, termId) {
  const cls = await schoolRecord(db, u, "classes", classId),
    term = await schoolRecord(db, u, "terms", termId);
  if (cls.academic_year_id !== term.academic_year_id)
    fail(422, "The class and term must belong to the same academic year.");
  return term;
}
export async function assertEditable(db, u, classId, termId) {
  const term = await matchTerm(db, u, classId, termId),
    school = await currentSchool(db, u),
    today = localClock(school.timezone).date;
  const control = await one(
    db,
    "SELECT * FROM academic_term_controls WHERE school_id=$1 AND term_id=$2",
    [u.school_id, termId],
  );
  const unlocked = control?.unlock_until && control.unlock_until >= today;
  if ((term.end_date < today || control?.closed) && !unlocked)
    fail(
      423,
      "This term is closed for score entry. An administrator must unlock it.",
    );
  const batch = await one(
    db,
    "SELECT * FROM report_batches WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
    [u.school_id, classId, termId],
  );
  if (batch && batch.status !== "DRAFT")
    fail(
      423,
      "Results are finalized. Reopen the report batch before changing assessments or scores.",
    );
  return term;
}
export async function subjectResults(
  db,
  u,
  classId,
  termId,
  { teacherScope = true } = {},
) {
  await matchTerm(db, u, classId, termId);
  const policy =
    (
      await one(
        db,
        "SELECT policy FROM academic_class_policies WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
        [u.school_id, classId, termId],
      )
    )?.policy || (await academicPolicy(db, u.school_id));
  const assignments = await rows(
    db,
    `SELECT cs.*,s.name AS subject_name,s.code,s.department,u.name AS teacher_name FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id JOIN users u ON u.id=cs.teacher_user_id WHERE cs.school_id=$1 AND cs.class_id=$2${teacherScope && u.role === "TEACHER" ? " AND cs.teacher_user_id=$3" : ""} ORDER BY s.name`,
    teacherScope && u.role === "TEACHER"
      ? [u.school_id, classId, u.id]
      : [u.school_id, classId],
  );
  const students = await termRoster(db, u, classId, termId);
  const assessments = await rows(
    db,
    "SELECT a.* FROM assessments a JOIN class_subjects cs ON cs.id=a.class_subject_id WHERE a.school_id=$1 AND cs.class_id=$2 AND a.term_id=$3 ORDER BY a.assessment_date,a.id",
    [u.school_id, classId, termId],
  );
  const scores = await rows(
    db,
    "SELECT sc.* FROM student_scores sc JOIN assessments a ON a.id=sc.assessment_id JOIN class_subjects cs ON cs.id=a.class_subject_id WHERE sc.school_id=$1 AND cs.class_id=$2 AND a.term_id=$3",
    [u.school_id, classId, termId],
  );
  const scoreMap = new Map(
    scores.map((s) => [`${s.assessment_id}:${s.student_id}`, Number(s.score)]),
  );
  const results = students.map((student) => {
    const subjects = assignments
      .filter(
        (cs) => !student.subject_ids || student.subject_ids.includes(cs.id),
      )
      .map((cs) => {
        const items = assessments
          .filter((a) => a.class_subject_id === cs.id)
          .map((a) => ({
            ...a,
            score: scoreMap.get(`${a.id}:${student.id}`) ?? null,
          }));
        const weight = round(
          items.reduce((n, a) => n + Number(a.weight_percent), 0),
        );
        const complete =
          items.length > 0 &&
          weight === 100 &&
          items.every((a) => a.score !== null);
        const total = complete
          ? round(
              items.reduce(
                (n, a) =>
                  n +
                  (a.score / Number(a.max_score)) * Number(a.weight_percent),
                0,
              ),
            )
          : null;
        return {
          class_subject_id: cs.id,
          subject_id: cs.subject_id,
          subject_name: cs.subject_name,
          code: cs.code,
          department: cs.department,
          teacher_user_id: cs.teacher_user_id,
          teacher_name: cs.teacher_name,
          credits: Number(cs.credits),
          weight_percent: weight,
          complete,
          total,
          grade: complete ? grade(total, policy).letter : null,
          grade_points: complete ? Number(grade(total, policy).points) : null,
          passed: complete ? total >= Number(policy.pass_mark) : null,
          assessments: items.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            max_score: Number(a.max_score),
            weight_percent: Number(a.weight_percent),
            score: a.score,
          })),
        };
      });
    const complete = subjects.length > 0 && subjects.every((s) => s.complete),
      credits = subjects.reduce((n, s) => n + s.credits, 0);
    const average = complete
      ? round(subjects.reduce((n, s) => n + s.total * s.credits, 0) / credits)
      : null;
    return {
      ...student,
      subjects,
      complete,
      overall_average: average,
      overall_grade: complete ? grade(average, policy).letter : null,
      gpa:
        complete && policy.gpa_enabled
          ? round(
              subjects.reduce((n, s) => n + s.grade_points * s.credits, 0) /
                credits,
            )
          : null,
      passed: complete ? average >= Number(policy.pass_mark) : null,
    };
  });
  return { policy, assignments, students: results };
}

export async function buildReports(tx, u, classId, termId) {
  const cls = await academicClass(tx, u, classId, { lock: true });
  await matchTerm(tx, u, classId, termId);
  let batch = await one(
    tx,
    "SELECT * FROM report_batches WHERE school_id=$1 AND class_id=$2 AND term_id=$3",
    [u.school_id, classId, termId],
  );
  if (batch && batch.status !== "DRAFT")
    fail(423, "Reopen this report batch before regenerating it.");
  const result = await subjectResults(tx, u, classId, termId, {
    teacherScope: false,
  });
  if (!result.students.length)
    fail(422, "There are no enrolled students in this class.");
  if (!result.assignments.length)
    fail(422, "Assign subjects before generating reports.");
  const incomplete = result.students.filter((s) => !s.complete);
  if (incomplete.length)
    fail(
      422,
      `Reports require all scores and assessment weights totaling 100% for every subject. Incomplete: ${incomplete
        .slice(0, 5)
        .map((s) => `${s.first_name} ${s.last_name}`)
        .join(", ")}.`,
    );
  const term = await schoolRecord(tx, u, "terms", termId),
    year = await schoolRecord(tx, u, "academic_years", term.academic_year_id),
    school = await currentSchool(tx, u);
  if (!batch)
    batch = await insert(tx, "report_batches", {
      school_id: u.school_id,
      class_id: classId,
      term_id: termId,
    });
  else
    await tx.query("UPDATE report_batches SET generated_at=now() WHERE id=$1", [
      batch.id,
    ]);
  const ranked = [...result.students].sort(
    (a, b) => b.overall_average - a.overall_average,
  );
  // Removed/transferred students cannot retain stale draft reports after regeneration.
  await tx.query(
    "DELETE FROM report_cards WHERE batch_id=$1 AND NOT(student_id=ANY($2::int[]))",
    [batch.id, result.students.map((s) => s.id)],
  );
  for (const s of result.students) {
    const rank = result.policy.ranking_enabled
      ? ranked.findIndex((r) => r.overall_average === s.overall_average) + 1
      : null;
    const attendance = await one(
      tx,
      "SELECT count(*)::int AS recorded,count(*) FILTER(WHERE status IN ('PRESENT','LATE'))::int AS present FROM student_attendance WHERE school_id=$1 AND student_id=$2 AND attendance_date BETWEEN $3 AND $4",
      [u.school_id, s.id, term.start_date, term.end_date],
    );
    const snapshot = {
      student: {
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        student_number: s.student_number,
      },
      school_name: school.name,
      class_name: cls.name,
      term_name: term.name,
      year_name: year.name,
      term_start: term.start_date,
      term_end: term.end_date,
      subjects: s.subjects,
      policy: result.policy,
      attendance: {
        ...attendance,
        percentage: attendance.recorded
          ? round((100 * attendance.present) / attendance.recorded)
          : null,
      },
      passed: s.passed,
    };
    await tx.query(
      "INSERT INTO report_cards(school_id,batch_id,student_id,overall_average,overall_grade,gpa,class_rank,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(batch_id,student_id) DO UPDATE SET overall_average=EXCLUDED.overall_average,overall_grade=EXCLUDED.overall_grade,gpa=EXCLUDED.gpa,class_rank=EXCLUDED.class_rank,snapshot=EXCLUDED.snapshot",
      [
        u.school_id,
        batch.id,
        s.id,
        s.overall_average,
        s.overall_grade,
        s.gpa,
        rank,
        JSON.stringify(snapshot),
      ],
    );
  }
  await audit(tx, u, "report_batches", batch.id, "GENERATE", null, {
    class_id: classId,
    term_id: termId,
    students: result.students.length,
  });
  return { ...batch, students: result.students.length };
}
export async function evaluateRisk(tx, schoolId) {
  const policy = await academicPolicy(tx, schoolId);
  const cards = await rows(
    tx,
    "SELECT rc.*,b.term_id,b.class_id,t.start_date FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id JOIN terms t ON t.id=b.term_id WHERE rc.school_id=$1 AND b.status IN ('FINALIZED','PUBLISHED') ORDER BY t.start_date,b.id",
    [schoolId],
  );
  const history = new Map();
  const active = [];
  for (const card of cards) {
    const cardPolicy = card.snapshot.policy || policy;
    const previous = (history.get(card.student_id) || []).filter(
      (c) => c.term_id !== card.term_id,
    );
    const failures = [...previous, card].slice(
      -cardPolicy.repeated_failure_terms,
    );
    const reasons = [];
    if (
      failures.length === cardPolicy.repeated_failure_terms &&
      failures.every((c) => c.snapshot.passed === false)
    )
      reasons.push([
        "REPEATED_FAILURE",
        `Below the pass mark in ${failures.length} consecutive finalized reports.`,
      ]);
    const last = previous.at(-1),
      decline = last
        ? round(Number(last.overall_average) - Number(card.overall_average))
        : 0;
    if (last && decline >= Number(cardPolicy.decline_threshold))
      reasons.push([
        "GRADE_DECLINE",
        `Average declined ${decline} points: ${last.overall_average}% to ${card.overall_average}%.`,
      ]);
    const att = card.snapshot.attendance;
    if (
      !card.snapshot.passed &&
      att.recorded >= 3 &&
      att.percentage < cardPolicy.risk_attendance_threshold
    )
      reasons.push([
        "LOW_ATTENDANCE_AND_PERFORMANCE",
        `${att.percentage}% attendance and ${card.overall_average}% academic average.`,
      ]);
    for (const [reason, detail] of reasons) {
      const flag = await one(
        tx,
        "INSERT INTO at_risk_flags(school_id,student_id,term_id,class_id,reason,detail) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(student_id,term_id,reason) DO UPDATE SET detail=EXCLUDED.detail,class_id=EXCLUDED.class_id,status=CASE WHEN at_risk_flags.resolved_by IS NULL THEN 'OPEN' ELSE at_risk_flags.status END,resolved_at=CASE WHEN at_risk_flags.resolved_by IS NULL THEN NULL ELSE at_risk_flags.resolved_at END,resolution_note=CASE WHEN at_risk_flags.resolved_by IS NULL THEN '' ELSE at_risk_flags.resolution_note END RETURNING *",
        [
          schoolId,
          card.student_id,
          card.term_id,
          card.class_id,
          reason,
          detail,
        ],
      );
      active.push(flag.id);
    }
    history.set(card.student_id, [...previous, card]);
  }
  await tx.query(
    "UPDATE at_risk_flags SET status='RESOLVED',resolved_at=now(),resolution_note='Automatically cleared: finalized results no longer meet this rule.' WHERE school_id=$1 AND status='OPEN' AND NOT(id=ANY($2::int[]))",
    [schoolId, active],
  );
}
export async function reportAccess(db, u, reportId) {
  const card = await one(
    db,
    "SELECT rc.*,b.class_id,b.term_id,b.status,b.revision,b.generated_at,b.finalized_at,b.published_at FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id WHERE rc.school_id=$1 AND rc.id=$2",
    [u.school_id, reportId],
  );
  if (!card) fail(404, "Report card not found.");
  if (u.role === "PARENT") {
    if (
      card.status !== "PUBLISHED" ||
      !(await one(
        db,
        "SELECT id FROM students WHERE school_id=$1 AND id=$2 AND parent_user_id=$3",
        [u.school_id, card.student_id, u.id],
      ))
    )
      fail(404, "Report card not found.");
  } else if (u.role === "STUDENT") {
    if (
      card.status !== "PUBLISHED" ||
      !(await one(
        db,
        "SELECT student_id FROM academic_student_accounts WHERE school_id=$1 AND student_id=$2 AND user_id=$3",
        [u.school_id, card.student_id, u.id],
      ))
    )
      fail(404, "Report card not found.");
  } else {
    if (!permitted(u, "reports.academic.read"))
      fail(403, "You cannot view report cards.");
    await academicClass(db, u, card.class_id, { homeroom: true });
  }
  return card;
}

export async function curriculumRows(db, u, termId, { summary = false } = {}) {
  const term = await schoolRecord(db, u, "terms", termId),
    school = await currentSchool(db, u),
    policy = await academicPolicy(db, u.school_id);
  const today = localClock(school.timezone).date,
    currentWeek = Math.max(
      0,
      Math.floor(
        (Date.parse(today) - Date.parse(term.start_date)) / 604800000,
      ) + 1,
    );
  const result = await rows(
    db,
    `SELECT t.*,s.name AS subject_name,s.department,c.name AS class_name,cs.class_id,cs.subject_id,cs.teacher_user_id,u.name AS teacher_name,l.completion_status,l.date_taught,l.lesson_duration_minutes,l.reason_for_noncompletion FROM curriculum_topics t JOIN class_subjects cs ON cs.id=t.class_subject_id JOIN subjects s ON s.id=cs.subject_id JOIN classes c ON c.id=cs.class_id JOIN users u ON u.id=cs.teacher_user_id LEFT JOIN LATERAL (SELECT * FROM curriculum_coverage_logs WHERE curriculum_topic_id=t.id ORDER BY date_taught DESC,id DESC LIMIT 1) l ON true WHERE t.school_id=$1 AND t.term_id=$2${u.role === "TEACHER" ? " AND cs.teacher_user_id=$3" : ""} ORDER BY c.name,s.name,t.sequence_order`,
    u.role === "TEACHER" ? [u.school_id, termId, u.id] : [u.school_id, termId],
  );
  return result.map((t) => ({
    ...t,
    completion_status: t.completion_status || "NOT_STARTED",
    current_week: currentWeek,
    behind:
      t.completion_status !== "COMPLETED" &&
      currentWeek - t.planned_week > policy.curriculum_lag_weeks,
  }));
}
export function groupCurriculum(topics, key = "class_subject_id") {
  const groups = new Map();
  for (const t of topics) {
    const k = t[key],
      g = groups.get(k) || {
        id: k,
        class_id: t.class_id,
        subject_id: t.subject_id,
        teacher_user_id: t.teacher_user_id,
        class_name: t.class_name,
        subject_name: t.subject_name,
        teacher_name: t.teacher_name,
        department: t.department,
        planned: 0,
        completed: 0,
        due: 0,
        behind: 0,
      };
    g.planned++;
    if (t.completion_status === "COMPLETED") g.completed++;
    if (t.planned_week <= t.current_week) g.due++;
    if (t.behind) g.behind++;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    coverage_percent: round((100 * g.completed) / g.planned),
  }));
}
export async function academicAnalytics(
  db,
  u,
  { term_id, class_id, subject_id, teacher_user_id },
) {
  const term = await schoolRecord(db, u, "terms", term_id);
  const classes = await rows(
    db,
    `SELECT c.* FROM classes c WHERE c.school_id=$1 AND c.academic_year_id=$2${class_id ? " AND c.id=$3" : ""}`,
    class_id
      ? [u.school_id, term.academic_year_id, class_id]
      : [u.school_id, term.academic_year_id],
  );
  const details = [];
  for (const cls of classes) {
    const batch = await one(
      db,
      "SELECT id FROM report_batches WHERE school_id=$1 AND class_id=$2 AND term_id=$3 AND status IN ('FINALIZED','PUBLISHED')",
      [u.school_id, cls.id, term_id],
    );
    let records;
    if (batch) {
      records = (
        await rows(db, "SELECT * FROM report_cards WHERE batch_id=$1", [
          batch.id,
        ])
      ).map((r) => ({
        id: r.student_id,
        first_name: r.snapshot.student.name,
        last_name: "",
        subjects: r.snapshot.subjects,
        finalized: true,
      }));
    } else records = (await subjectResults(db, u, cls.id, term_id)).students;
    for (const student of records)
      for (const s of student.subjects) {
        if (
          (u.role === "TEACHER" && s.teacher_user_id !== u.id) ||
          (subject_id && s.subject_id !== subject_id) ||
          (teacher_user_id && s.teacher_user_id !== teacher_user_id)
        )
          continue;
        details.push({
          student_id: student.id,
          student_name: `${student.first_name} ${student.last_name}`.trim(),
          class_id: cls.id,
          class_name: cls.name,
          ...s,
          finalized: !!student.finalized,
        });
      }
  }
  const aggregate = (records) => {
    const complete = records.filter((r) => r.complete);
    return {
      records: records.length,
      completed: complete.length,
      incomplete: records.length - complete.length,
      average: complete.length
        ? round(
            complete.reduce((n, r) => n + Number(r.total), 0) / complete.length,
          )
        : null,
      pass_rate: complete.length
        ? round(
            (100 * complete.filter((r) => r.passed).length) / complete.length,
          )
        : null,
    };
  };
  const grouped = (key) => {
    const groups = new Map();
    for (const r of details) {
      const list = groups.get(r[key]) || [];
      list.push(r);
      groups.set(r[key], list);
    }
    return [...groups.entries()].map(([id, records]) => ({
      id,
      class_name: records[0].class_name,
      subject_name: records[0].subject_name,
      teacher_name: records[0].teacher_name,
      ...aggregate(records),
    }));
  };
  const history = await rows(
    db,
    "SELECT rc.*,b.class_id,b.term_id,t.name AS term_name,t.start_date,c.name AS class_name FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id JOIN terms t ON t.id=b.term_id JOIN classes c ON c.id=b.class_id WHERE rc.school_id=$1 AND b.status IN ('FINALIZED','PUBLISHED') AND t.start_date<=$2 ORDER BY t.start_date",
    [u.school_id, term.start_date],
  );
  const trendMap = new Map();
  for (const r of history) {
    if (class_id && r.class_id !== class_id) continue;
    const subjects = r.snapshot.subjects.filter(
      (s) =>
        (u.role !== "TEACHER" || s.teacher_user_id === u.id) &&
        (!subject_id || s.subject_id === subject_id) &&
        (!teacher_user_id || s.teacher_user_id === teacher_user_id),
    );
    if (!subjects.length) continue;
    const g = trendMap.get(r.term_id) || {
      id: r.term_id,
      term_name: r.term_name,
      start_date: r.start_date,
      items: [],
    };
    g.items.push(...subjects);
    trendMap.set(r.term_id, g);
  }
  const trend = [...trendMap.values()].map((g) => ({
    id: g.id,
    term_name: g.term_name,
    start_date: g.start_date,
    ...aggregate(g.items),
  }));
  return {
    summary: aggregate(details),
    classes: grouped("class_id"),
    subjects: grouped("subject_id"),
    teachers: grouped("teacher_user_id"),
    trend,
    students: permitted(u, "analytics.read") ? details : undefined,
  };
}
