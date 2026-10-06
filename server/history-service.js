import { one, rows, insert } from "./db.js";
import { fail, localClock } from "./security.js";
import { schoolRecord, currentSchool } from "./services.js";
export async function ensureRoster(db, u, classId, termId) {
  const cls = await schoolRecord(db, u, "classes", classId),
    term = await schoolRecord(db, u, "terms", termId);
  if (cls.academic_year_id !== term.academic_year_id)
    fail(422, "Class and term must belong to the same academic year.");
  await db.query(
    `WITH new_set AS (
 INSERT INTO academic_roster_sets(school_id,class_id,term_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING school_id
 ), evidence AS (
 SELECT sc.student_id,'EXISTING_RESULTS' AS source FROM student_scores sc JOIN assessments a ON a.id=sc.assessment_id JOIN class_subjects cs ON cs.id=a.class_subject_id WHERE sc.school_id=$1 AND cs.class_id=$2 AND a.term_id=$3
 UNION SELECT rc.student_id,'EXISTING_RESULTS' FROM report_cards rc JOIN report_batches b ON b.id=rc.batch_id WHERE rc.school_id=$1 AND b.class_id=$2 AND b.term_id=$3
 UNION SELECT e.student_id,'HISTORICAL_ENROLLMENT' FROM student_enrollment e JOIN terms t ON t.id=$3 AND e.enrollment_date<=t.end_date WHERE e.school_id=$1 AND e.class_id=$2 AND NOT EXISTS(SELECT 1 FROM student_enrollment later WHERE later.school_id=e.school_id AND later.student_id=e.student_id AND later.enrollment_date>e.enrollment_date AND later.enrollment_date<=t.start_date)
 ), members AS (
 SELECT student_id,source FROM evidence
 UNION ALL SELECT id,'INITIAL_ROSTER' FROM students WHERE school_id=$1 AND class_id=$2 AND status IN ('ENROLLED','SUSPENDED') AND NOT EXISTS(SELECT 1 FROM evidence) AND NOT EXISTS(SELECT 1 FROM student_enrollment WHERE school_id=$1 AND class_id=$2)
 ) INSERT INTO academic_rosters(school_id,class_id,term_id,student_id,source)
 SELECT $1,$2,$3,m.student_id,m.source FROM members m CROSS JOIN new_set ON CONFLICT DO NOTHING`,
    [u.school_id, classId, termId],
  );
}
export async function termRoster(db, u, classId, termId) {
  await ensureRoster(db, u, classId, termId);
  return rows(
    db,
    "SELECT s.id,s.first_name,s.last_name,s.student_number,r.subject_ids,r.source FROM academic_rosters r JOIN students s ON s.id=r.student_id WHERE r.school_id=$1 AND r.class_id=$2 AND r.term_id=$3 AND NOT r.excluded ORDER BY s.last_name,s.first_name",
    [u.school_id, classId, termId],
  );
}
export async function preserveBeforeTransfer(db, u, student) {
  if (!student.class_id) return;
  const school = await currentSchool(db, u),
    today = localClock(school.timezone).date;
  for (const term of await rows(
    db,
    "SELECT t.id FROM terms t JOIN classes c ON c.academic_year_id=t.academic_year_id AND c.school_id=t.school_id WHERE c.school_id=$1 AND c.id=$2 AND t.start_date<=$3",
    [u.school_id, student.class_id, today],
  ))
    await ensureRoster(db, u, student.class_id, term.id);
}
export async function rosterAfterTransfer(db, u, student, classId) {
  const school = await currentSchool(db, u),
    today = localClock(school.timezone).date;
  for (const term of await rows(
    db,
    "SELECT t.id FROM terms t JOIN classes c ON c.academic_year_id=t.academic_year_id AND c.school_id=t.school_id WHERE c.school_id=$1 AND c.id=$2 AND t.end_date>=$3",
    [u.school_id, classId, today],
  )) {
    await ensureRoster(db, u, classId, term.id);
    await db.query(
      "INSERT INTO academic_rosters(school_id,class_id,term_id,student_id,source) VALUES($1,$2,$3,$4,'TRANSFER_IN') ON CONFLICT DO NOTHING",
      [u.school_id, classId, term.id, student.id],
    );
  }
}
export async function archiveBatch(db, u, batch, reason) {
  for (const card of await rows(
    db,
    "SELECT * FROM report_cards WHERE school_id=$1 AND batch_id=$2",
    [u.school_id, batch.id],
  ))
    await db.query(
      "INSERT INTO report_revisions(school_id,report_card_id,revision,record,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(report_card_id,revision) DO NOTHING",
      [
        u.school_id,
        card.id,
        batch.revision,
        JSON.stringify({
          ...card,
          term_id: batch.term_id,
          class_id: batch.class_id,
          status: batch.status,
          revision: batch.revision,
        }),
        reason,
      ],
    );
}
export async function workCalendar(db, schoolId) {
  await db.query(
    "INSERT INTO work_calendars(school_id) VALUES($1) ON CONFLICT DO NOTHING",
    [schoolId],
  );
  return {
    ...(await one(db, "SELECT * FROM work_calendars WHERE school_id=$1", [
      schoolId,
    ])),
    holidays: await rows(
      db,
      "SELECT * FROM school_holidays WHERE school_id=$1 ORDER BY date",
      [schoolId],
    ),
  };
}
export async function workingDates(db, schoolId, from, to) {
  const calendar = await workCalendar(db, schoolId),
    holidays = new Set(calendar.holidays.map((h) => h.date)),
    dates = [];
  for (
    let d = new Date(from + "T12:00:00Z");
    d <= new Date(to + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const date = d.toISOString().slice(0, 10);
    if (calendar.weekdays.includes(d.getUTCDay()) && !holidays.has(date))
      dates.push(date);
  }
  return dates;
}
export async function approveLeave(tx, u, l) {
  await tx.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
    u.school_id,
  ]);
  const dates = await workingDates(tx, u.school_id, l.start_date, l.end_date);
  if (!dates.length) fail(422, "This range contains no working days.");
  const calendar = await workCalendar(tx, u.school_id);
  for (const year of new Set(dates.map((d) => d.slice(0, 4)))) {
    const used = await one(
      tx,
      "SELECT count(DISTINCT attendance_date)::int AS n FROM (SELECT d.attendance_date FROM leave_attendance_changes d JOIN leave_requests l ON l.id=d.leave_id WHERE l.school_id=$1 AND l.staff_id=$2 AND l.cancelled_at IS NULL UNION SELECT a.attendance_date FROM staff_attendance a JOIN leave_requests l ON l.staff_id=a.staff_id AND a.attendance_date BETWEEN l.start_date AND l.end_date WHERE l.school_id=$1 AND l.staff_id=$2 AND l.status='APPROVED' AND l.working_days IS NULL AND l.cancelled_at IS NULL AND a.status='LEAVE') used WHERE attendance_date BETWEEN $3::date AND $4::date",
      [u.school_id, l.staff_id, `${year}-01-01`, `${year}-12-31`],
    );
    if (
      used.n + dates.filter((d) => d.startsWith(year)).length >
      calendar.annual_leave_days
    )
      fail(422, `Annual leave allowance exceeded for ${year}.`);
  }
  for (const date of dates) {
    const prior = await one(
      tx,
      "SELECT * FROM staff_attendance WHERE school_id=$1 AND staff_id=$2 AND attendance_date=$3 FOR UPDATE",
      [u.school_id, l.staff_id, date],
    );
    if (prior && (prior.check_in_time || prior.status !== "ABSENT"))
      fail(
        409,
        "Attendance already exists on a working day in this range. Resolve it before approving leave.",
      );
    const record = await one(
      tx,
      "INSERT INTO staff_attendance(school_id,staff_id,attendance_date,status) VALUES($1,$2,$3,'LEAVE') ON CONFLICT(staff_id,attendance_date) DO UPDATE SET status='LEAVE' RETURNING *",
      [u.school_id, l.staff_id, date],
    );
    await insert(tx, "leave_attendance_changes", {
      school_id: u.school_id,
      leave_id: l.id,
      attendance_date: date,
      attendance_id: record.id,
      previous_record: prior ? JSON.stringify(prior) : null,
    });
  }
  await tx.query("UPDATE leave_requests SET working_days=$2 WHERE id=$1", [
    l.id,
    dates.length,
  ]);
}
