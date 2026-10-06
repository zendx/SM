import { openTestDatabase } from "./database.js";
import { test, before, after } from "./database.js";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { insert, one, rows } from "../server/db.js";
import { createApp } from "../server/app.js";
import { hashPassword, localClock } from "../server/security.js";
import { parseTopicCsv } from "../server/academic-routes.js";
import { subjectResults } from "../server/academic-service.js";
process.env.REQUIRE_MFA = "false";
let db,
  server,
  base,
  school,
  otherSchool,
  year,
  term,
  oldTerm,
  cls,
  otherClass,
  student,
  student2,
  math,
  english,
  assignment,
  englishAssignment,
  ca,
  exam,
  englishExam,
  batch,
  card,
  oldBatch,
  topic;
const accounts = {},
  clients = {};
const today = localClock("Africa/Lagos").date;
const day = (offset) => {
  const value = new Date(`${today}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
async function request(who, path, method = "GET", body, expected = 200) {
  const client = clients[who];
  const response = await fetch(base + path, {
    method,
    headers: {
      Cookie: client.cookie,
      "x-csrf-token": client.csrf,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {}
  assert.equal(response.status, expected, `${who}: ${method} ${path}: ${raw}`);
  return result?.data;
}
before(async () => {
  db = await openTestDatabase();
  const app = await createApp(db);
  school = await insert(db, "schools", {
    name: "Academic Test School",
    short_code: "ACA",
  });
  otherSchool = await insert(db, "schools", {
    name: "Other School",
    short_code: "OTH",
  });
  for (const [name, role, schoolId] of [
    ["admin", "SUPER_ADMIN", school.id],
    ["principal", "PRINCIPAL", school.id],
    ["vp", "VICE_PRINCIPAL", school.id],
    ["teacher", "TEACHER", school.id],
    ["english", "TEACHER", school.id],
    ["unassigned", "TEACHER", school.id],
    ["parent", "PARENT", school.id],
    ["otherparent", "PARENT", school.id],
    ["pupil", "STUDENT", school.id],
    ["board", "PROPRIETOR", school.id],
    ["finance", "FINANCE_OFFICER", school.id],
    ["outsider", "SUPER_ADMIN", otherSchool.id],
  ])
    accounts[name] = await insert(db, "users", {
      school_id: schoolId,
      name,
      email: `${name}@academic.test`,
      role,
      password_hash: hashPassword("Academic-test-password!"),
    });
  year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "Test school year",
    start_date: day(-300),
    end_date: day(300),
  });
  oldTerm = await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Term 1",
    start_date: day(-200),
    end_date: day(-100),
  });
  term = await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Term 2",
    start_date: day(-90),
    end_date: day(30),
    is_current: true,
  });
  cls = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Grade 5A",
    capacity: 30,
    teacher_user_id: accounts.teacher.id,
  });
  otherClass = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Grade 5B",
    capacity: 30,
    teacher_user_id: accounts.unassigned.id,
  });
  for (const [first, last, parentId] of [
    ["Amara", "Obi", accounts.parent.id],
    ["Chinedu", "Eze", accounts.otherparent.id],
  ]) {
    const s = await insert(db, "students", {
      school_id: school.id,
      first_name: first,
      last_name: last,
      student_number: `ACA-${first}`,
      gender: "OTHER",
      date_of_birth: "2016-01-01",
      guardian_name: "Guardian",
      guardian_phone: "08000000000",
      parent_user_id: parentId,
      class_id: cls.id,
      status: "ENROLLED",
    });
    if (!student) student = s;
    else student2 = s;
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  for (const [name, account] of Object.entries(accounts)) {
    const response = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: "Academic-test-password!",
      }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()).data;
    clients[name] = {
      cookie: response.headers.get("set-cookie").split(";")[0],
      csrf: payload.csrf,
    };
  }
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

test("academic setup enforces roles, tenant relationships and approved grading defaults", async () => {
  const setup = await request("admin", "/academics/setup");
  assert.equal(setup.policy.pass_mark, "50.00");
  assert.equal(setup.policy.ranking_enabled, false);
  assert.deepEqual(
    setup.policy.grading_scale.map((g) => g.minimum),
    [70, 60, 50, 45, 40, 0],
  );
  await request("finance", "/academics/setup", "GET", undefined, 403);
  await request("parent", "/subjects", "GET", undefined, 403);
  math = await request("principal", "/subjects", "POST", {
    name: "Mathematics",
    code: "MTH",
    department: "Sciences",
  });
  english = await request("vp", "/subjects", "POST", {
    name: "English",
    code: "ENG",
    department: "Languages",
  });
  await request(
    "teacher",
    "/subjects",
    "POST",
    { name: "Unauthorized", code: "NO" },
    403,
  );
  await request(
    "outsider",
    "/class-subjects",
    "POST",
    {
      class_id: cls.id,
      subject_id: math.id,
      teacher_user_id: accounts.teacher.id,
    },
    404,
  );
  await request(
    "principal",
    "/class-subjects",
    "POST",
    {
      class_id: cls.id,
      subject_id: math.id,
      teacher_user_id: accounts.parent.id,
    },
    422,
  );
  assignment = await request("principal", "/class-subjects", "POST", {
    class_id: cls.id,
    subject_id: math.id,
    teacher_user_id: accounts.teacher.id,
    credits: 2,
  });
  englishAssignment = await request("vp", "/class-subjects", "POST", {
    class_id: cls.id,
    subject_id: english.id,
    teacher_user_id: accounts.english.id,
    credits: 1,
  });
  assert.equal(
    (await request("teacher", "/academics/setup")).assignments.length,
    1,
  );
});
test("assessment weights, term dates and subject-only teacher access are enforced", async () => {
  const payload = {
    class_subject_id: assignment.id,
    term_id: term.id,
    name: "CA 1",
    type: "CA",
    max_score: 20,
    weight_percent: 40,
    assessment_date: today,
  };
  await request("english", "/assessments", "POST", payload, 403);
  await request(
    "teacher",
    "/assessments",
    "POST",
    { ...payload, assessment_date: day(-150) },
    422,
  );
  ca = await request("teacher", "/assessments", "POST", payload);
  await request(
    "teacher",
    "/assessments",
    "POST",
    { ...payload, name: "Too much weight", weight_percent: 70 },
    422,
  );
  exam = await request("teacher", "/assessments", "POST", {
    ...payload,
    name: "Term examination",
    type: "EXAM",
    max_score: 60,
    weight_percent: 60,
  });
  englishExam = await request("english", "/assessments", "POST", {
    ...payload,
    class_subject_id: englishAssignment.id,
    name: "English exam",
    type: "EXAM",
    max_score: 100,
    weight_percent: 100,
  });
  assert.equal(
    (await request("teacher", `/assessments?term_id=${term.id}`)).length,
    2,
  );
  await request(
    "unassigned",
    `/assessments/${ca.id}/scores`,
    "GET",
    undefined,
    403,
  );
  await request(
    "outsider",
    `/assessments/${ca.id}/scores`,
    "GET",
    undefined,
    404,
  );
  await request(
    "teacher",
    "/report-cards/generate",
    "POST",
    { class_id: cls.id, term_id: term.id },
    403,
  );
  await request(
    "principal",
    "/report-cards/generate",
    "POST",
    { class_id: cls.id, term_id: term.id },
    422,
  );
});
test("score validation is atomic and weighted totals, grades, GPA and ties are correct", async () => {
  const payload = {
    scores: [
      { student_id: student.id, score: 20 },
      { student_id: student2.id, score: 21 },
    ],
  };
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    payload,
    422,
  );
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM student_scores")).n,
    0,
  );
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    { scores: [{ student_id: student.id, score: -1 }] },
    422,
  );
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    { scores: [{ student_id: student.id, score: 10.001 }] },
    422,
  );
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    {
      scores: [
        { student_id: student.id, score: 10 },
        { student_id: student.id, score: 12 },
      ],
    },
    422,
  );
  for (const [a, value, who] of [
    [ca, 15, "teacher"],
    [exam, 45, "teacher"],
    [englishExam, 60, "english"],
  ])
    await request(who, `/assessments/${a.id}/scores`, "POST", {
      scores: [
        { student_id: student.id, score: value },
        { student_id: student2.id, score: value },
      ],
    });
  const policy = (await request("admin", "/academics/setup")).policy;
  await request("principal", "/academics/settings", "PATCH", {
    ...policy,
    ranking_enabled: true,
    gpa_enabled: true,
  });
  const gradebook = await request(
    "principal",
    `/academics/gradebook?class_id=${cls.id}&term_id=${term.id}`,
  );
  assert.equal(
    gradebook.students[0].subjects.find((s) => s.code === "MTH").total,
    75,
  );
  assert.equal(gradebook.students[0].overall_average, 70);
  assert.equal(gradebook.students[0].overall_grade, "A");
  assert.equal(gradebook.students[0].gpa, 4.67);
  assert.equal(
    (
      await request(
        "teacher",
        `/academics/gradebook?class_id=${cls.id}&term_id=${term.id}`,
      )
    ).students[0].subjects.length,
    1,
  );
  await request(
    "teacher",
    `/assessments/${ca.id}`,
    "PATCH",
    { ...ca, max_score: 10 },
    422,
  );
  batch = await request("vp", "/report-cards/generate", "POST", {
    class_id: cls.id,
    term_id: term.id,
  });
  const cards = await request("principal", `/report-cards?term_id=${term.id}`);
  assert.equal(cards.length, 2);
  assert.ok(cards.every((c) => c.class_rank === 1));
  card = cards.find((c) => c.student_id === student.id);
  await request("parent", `/report-cards/${card.id}`, "GET", undefined, 404);
  assert.equal(
    (await request("parent", `/report-cards?term_id=${term.id}`)).length,
    0,
  );
});
test("draft comments, finalization and publication preserve access and immutable snapshots", async () => {
  await request("english", `/report-cards/${card.id}`, "GET", undefined, 403);
  await request(
    "teacher",
    `/report-cards/${card.id}/comments`,
    "PATCH",
    {
      teacher_comment: "Good progress.",
      principal_comment: "Forged principal comment",
    },
    403,
  );
  await request("teacher", `/report-cards/${card.id}/comments`, "PATCH", {
    teacher_comment: "Good progress.",
    principal_comment: "",
  });
  await request(
    "principal",
    `/report-batches/${batch.id}/publish`,
    "POST",
    {},
    422,
  );
  await request("vp", `/report-batches/${batch.id}/finalize`, "POST", {});
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    { scores: [{ student_id: student.id, score: 19 }] },
    423,
  );
  await request("vp", `/report-batches/${batch.id}/publish`, "POST", {}, 403);
  await request(
    "parent",
    `/report-cards/${card.id}?format=pdf`,
    "GET",
    undefined,
    404,
  );
  await request("principal", `/report-cards/${card.id}/publish`, "PATCH", {});
  assert.equal(
    (await request("parent", `/report-cards?term_id=${term.id}`)).length,
    1,
  );
  await request(
    "otherparent",
    `/report-cards/${card.id}`,
    "GET",
    undefined,
    404,
  );
  await request("outsider", `/report-cards/${card.id}`, "GET", undefined, 404);
  const report = await request("parent", `/report-cards/${card.id}`);
  assert.equal(report.teacher_comment, "Good progress.");
  assert.equal(report.snapshot.subjects.length, 2);
  const policy = (await request("admin", "/academics/setup")).policy;
  await request(
    "principal",
    "/academics/settings",
    "PATCH",
    {
      ...policy,
      pass_mark: 80,
      grading_scale: [
        { letter: "Excellent", minimum: 80, points: 5 },
        { letter: "F", minimum: 0, points: 0 },
      ],
    },
    422,
  );
  await request("principal", "/academics/settings", "PATCH", {
    ...policy,
    pass_mark: 80,
  });
  assert.equal(
    (await request("parent", `/report-cards/${card.id}`)).snapshot.policy
      .pass_mark,
    "50.00",
  );
  assert.equal(
    (await request("principal", `/analytics/academics?term_id=${term.id}`))
      .summary.pass_rate,
    100,
  );
  await request("principal", "/academics/settings", "PATCH", policy);
  await request("admin", "/academics/student-account", "POST", {
    student_id: student.id,
    user_id: accounts.pupil.id,
  });
  assert.equal(
    (await request("pupil", `/report-cards?term_id=${term.id}`)).length,
    1,
  );
  const pdf = await fetch(base + `/report-cards/${card.id}?format=pdf`, {
    headers: { Cookie: clients.parent.cookie },
  });
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  await request(
    "vp",
    `/report-batches/${batch.id}/reopen`,
    "POST",
    { reason: "Correct marks" },
    403,
  );
  await request(
    "principal",
    `/report-batches/${batch.id}/reopen`,
    "POST",
    { reason: "" },
    422,
  );
  await request("principal", `/report-batches/${batch.id}/reopen`, "POST", {
    reason: "Review the assessment marks",
  });
  await request("parent", `/report-cards/${card.id}`, "GET", undefined, 404);
  assert.equal(
    (await request("principal", `/report-cards/${card.id}`)).revision,
    2,
  );
});
test("term closing and expiring administrator unlocks apply to all teachers", async () => {
  await request("admin", `/academics/terms/${term.id}/control`, "PATCH", {
    closed: true,
    reason: "Term ended",
  });
  assert.equal(
    (await request("teacher", `/assessments/${ca.id}/scores`)).locked,
    true,
  );
  await request(
    "teacher",
    `/assessments/${ca.id}/scores`,
    "POST",
    { scores: [{ student_id: student.id, score: 10 }] },
    423,
  );
  await request(
    "principal",
    `/academics/terms/${term.id}/control`,
    "PATCH",
    { closed: false, reason: "Unauthorized unlock" },
    403,
  );
  await request(
    "admin",
    `/academics/terms/${term.id}/control`,
    "PATCH",
    { closed: true, unlock_until: day(-1), reason: "Expired" },
    422,
  );
  await request("admin", `/academics/terms/${term.id}/control`, "PATCH", {
    closed: true,
    unlock_until: today,
    reason: "Approved corrections",
  });
  await request("teacher", `/assessments/${ca.id}/scores`, "POST", {
    scores: [
      { student_id: student.id, score: 8 },
      { student_id: student2.id, score: 8 },
    ],
  });
  await request("teacher", `/assessments/${exam.id}/scores`, "POST", {
    scores: [
      { student_id: student.id, score: 24 },
      { student_id: student2.id, score: 24 },
    ],
  });
  await request("english", `/assessments/${englishExam.id}/scores`, "POST", {
    scores: [
      { student_id: student.id, score: 40 },
      { student_id: student2.id, score: 40 },
    ],
  });
  const historical = {
    class_subject_id: assignment.id,
    term_id: oldTerm.id,
    name: "Historical assessment",
    type: "EXAM",
    max_score: 100,
    weight_percent: 100,
    assessment_date: day(-150),
  };
  await request("teacher", "/assessments", "POST", historical, 423);
  await request("admin", `/academics/terms/${oldTerm.id}/control`, "PATCH", {
    closed: false,
    unlock_until: today,
    reason: "Import historical results",
  });
  for (const [csId, who, values] of [
    [assignment.id, "teacher", [90, 45]],
    [englishAssignment.id, "english", [90, 45]],
  ]) {
    const a = await request(who, "/assessments", "POST", {
      ...historical,
      class_subject_id: csId,
    });
    await request(who, `/assessments/${a.id}/scores`, "POST", {
      scores: [
        { student_id: student.id, score: values[0] },
        { student_id: student2.id, score: values[1] },
      ],
    });
  }
  oldBatch = await request("principal", "/report-cards/generate", "POST", {
    class_id: cls.id,
    term_id: oldTerm.id,
  });
  await request(
    "principal",
    `/report-batches/${oldBatch.id}/finalize`,
    "POST",
    {},
  );
});
test("finalization identifies grade decline, repeated failure and low attendance without exposing names to the board", async () => {
  for (const offset of [-2, -1, 0])
    await insert(db, "student_attendance", {
      school_id: school.id,
      student_id: student.id,
      class_id: cls.id,
      attendance_date: day(offset),
      status: "ABSENT",
      recorded_by: accounts.teacher.id,
    });
  await request(
    "principal",
    `/report-batches/${batch.id}/finalize`,
    "POST",
    {},
  );
  const risks = await request(
    "principal",
    `/analytics/academics/at-risk?term_id=${term.id}`,
  );
  assert.equal(risks.length, 3);
  assert.ok(
    risks.some(
      (r) => r.reason === "GRADE_DECLINE" && r.student_id === student.id,
    ),
  );
  assert.ok(risks.some((r) => r.reason === "LOW_ATTENDANCE_AND_PERFORMANCE"));
  assert.ok(
    risks.some(
      (r) => r.reason === "REPEATED_FAILURE" && r.student_id === student2.id,
    ),
  );
  assert.equal(
    (
      await request(
        "teacher",
        `/analytics/academics/at-risk?term_id=${term.id}`,
      )
    ).length,
    3,
  );
  assert.equal(
    (
      await request(
        "english",
        `/analytics/academics/at-risk?term_id=${term.id}`,
      )
    ).length,
    0,
  );
  await request(
    "board",
    `/analytics/academics/at-risk?term_id=${term.id}`,
    "GET",
    undefined,
    403,
  );
  const board = await request(
    "board",
    `/analytics/academics?term_id=${term.id}`,
  );
  assert.equal(board.students, undefined);
  assert.equal(JSON.stringify(board).includes("Amara"), false);
  assert.equal(board.trend.length, 2);
  assert.equal(board.trend[1].average, 40);
  const overview = await request(
    "board",
    `/academics/overview?term_id=${term.id}`,
  );
  assert.equal(overview.at_risk, 2);
  const teacher = await request(
    "teacher",
    `/analytics/academics?term_id=${term.id}`,
  );
  assert.equal(teacher.subjects.length, 1);
  assert.equal(teacher.students.length, 2);
  const filtered = await request(
    "principal",
    `/analytics/academics?term_id=${term.id}&subject_id=${english.id}`,
  );
  assert.equal(filtered.subjects.length, 1);
  assert.equal(filtered.summary.completed, 2);
  await request(
    "teacher",
    `/analytics/academics/at-risk/${risks[0].id}/resolve`,
    "PATCH",
    { note: "" },
    422,
  );
  await request(
    "unassigned",
    `/analytics/academics/at-risk/${risks[0].id}/resolve`,
    "PATCH",
    { note: "Not my class" },
    403,
  );
  await request(
    "teacher",
    `/analytics/academics/at-risk/${risks[0].id}/resolve`,
    "PATCH",
    { note: "Parent meeting and weekly tutoring arranged." },
  );
  assert.equal(
    (
      await request(
        "teacher",
        `/analytics/academics/at-risk?term_id=${term.id}`,
      )
    ).filter((r) => r.status === "RESOLVED").length,
    1,
  );
});
test("curriculum CSV import handles quoted fields and rolls back malformed or duplicate rows", async () => {
  assert.equal(
    parseTopicCsv(
      'topic_name,planned_week,sequence_order\r\n"Fractions, ratios",1,1',
    )[0].topic_name,
    "Fractions, ratios",
  );
  assert.throws(() =>
    parseTopicCsv('topic_name,planned_week,sequence_order\n"Unclosed,1,1'),
  );
  const payload = {
    class_subject_id: assignment.id,
    term_id: term.id,
    csv: 'topic_name,planned_week,sequence_order\n"Fractions, ratios",1,1\nGeometry,2,2',
  };
  await request("teacher", "/curriculum/topics/import", "POST", payload, 403);
  assert.equal(
    (await request("vp", "/curriculum/topics/import", "POST", payload))
      .imported,
    2,
  );
  await request(
    "vp",
    "/curriculum/topics/import",
    "POST",
    {
      ...payload,
      csv: "topic_name,planned_week,sequence_order\nWould rollback,3,3\nDuplicate,2,2",
    },
    409,
  );
  assert.equal(
    (await request("teacher", `/curriculum/topics?term_id=${term.id}`)).length,
    2,
  );
  await request(
    "principal",
    "/curriculum/topics",
    "POST",
    {
      class_subject_id: assignment.id,
      term_id: term.id,
      topic_name: "Beyond term",
      planned_week: 53,
      sequence_order: 4,
    },
    422,
  );
  topic = (
    await request("teacher", `/curriculum/topics?term_id=${term.id}`)
  )[0];
  assert.equal(topic.behind, true);
});
test("curriculum logging validates dates, requires reasons and uses latest teaching-date entries", async () => {
  const payload = {
    curriculum_topic_id: topic.id,
    date_taught: today,
    lesson_duration_minutes: 40,
    completion_status: "PARTIAL",
  };
  await request("english", "/curriculum/coverage-logs", "POST", payload, 403);
  await request("teacher", "/curriculum/coverage-logs", "POST", payload, 422);
  await request(
    "teacher",
    "/curriculum/coverage-logs",
    "POST",
    { ...payload, date_taught: day(1), reason_for_noncompletion: "Future" },
    422,
  );
  await request("teacher", "/curriculum/coverage-logs", "POST", {
    ...payload,
    reason_for_noncompletion: "Extra practice required.",
  });
  await request("teacher", "/curriculum/coverage-logs", "POST", {
    ...payload,
    completion_status: "COMPLETED",
  });
  await request("teacher", "/curriculum/coverage-logs", "POST", {
    ...payload,
    date_taught: day(-1),
    reason_for_noncompletion: "Backdated partial lesson",
  });
  const topics = await request(
    "teacher",
    `/curriculum/topics?term_id=${term.id}`,
  );
  assert.equal(
    topics.find((t) => t.id === topic.id).completion_status,
    "COMPLETED",
  );
  const dashboard = await request(
    "principal",
    `/curriculum/dashboard?term_id=${term.id}`,
  );
  assert.equal(dashboard.summary.planned, 2);
  assert.equal(dashboard.summary.completed, 1);
  assert.equal(dashboard.summary.coverage_percent, 50);
  assert.equal(dashboard.summary.behind, 1);
  assert.equal(
    (await request("teacher", `/curriculum/topics/${topic.id}/history`)).length,
    3,
  );
  await request(
    "outsider",
    `/curriculum/topics/${topic.id}/history`,
    "GET",
    undefined,
    404,
  );
  assert.equal(
    (await request("english", `/curriculum/dashboard?term_id=${term.id}`))
      .summary.planned,
    0,
  );
});
test("academic exports produce real PDF, Excel and CSV and respect permissions", async () => {
  for (const [key, format] of [
    ["classes", "csv"],
    ["subjects", "xlsx"],
    ["teachers", "pdf"],
    ["curriculum", "xlsx"],
  ]) {
    const response = await fetch(
      `${base}/academics/reports/${key}?term_id=${term.id}&format=${format}`,
      { headers: { Cookie: clients.principal.cookie } },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const bytes = Buffer.from(await response.arrayBuffer());
    if (format === "pdf")
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      assert.ok(workbook.worksheets[0].rowCount >= 2);
    }
    if (format === "csv") assert.match(bytes.toString(), /Grade 5A/);
  }
  await request(
    "parent",
    `/academics/reports/classes?term_id=${term.id}`,
    "GET",
    undefined,
    403,
  );
  await request(
    "outsider",
    `/academics/reports/classes?term_id=${term.id}`,
    "GET",
    undefined,
    404,
  );
  const logs = await rows(
    db,
    "SELECT * FROM audit_logs WHERE school_id=$1 AND entity_type IN ('student_scores','report_batches','curriculum_coverage_logs','at_risk_flags')",
    [school.id],
  );
  assert.ok(logs.some((l) => l.action === "PUBLISH"));
  assert.ok(logs.some((l) => l.action === "FINALIZE"));
  assert.ok(logs.some((l) => l.action === "RESOLVE"));
});

test("transfers preserve term rosters, published snapshots and archived report PDFs", async () => {
  const before = await request("principal", `/report-cards/${card.id}`);
  await request("admin", `/students/${student.id}/enrollment`, "POST", {
    class_id: otherClass.id,
  });
  await request("principal", `/report-batches/${batch.id}/reopen`, "POST", {
    reason: "Reconstruct after transfer",
  });
  const history = await request(
    "teacher",
    `/report-cards/${card.id}/revisions`,
  );
  assert.ok(history.some((h) => h.revision === before.revision));
  const archived = await request(
    "teacher",
    `/report-cards/${card.id}?revision=${before.revision}`,
  );
  assert.deepEqual(archived.snapshot, before.snapshot);
  const roster = await request("teacher", `/assessments/${ca.id}/scores`);
  assert.ok(roster.students.some((s) => s.id === student.id));
  await request("principal", "/report-cards/generate", "POST", {
    class_id: cls.id,
    term_id: term.id,
  });
  const reconstructed = await request("teacher", `/report-cards/${card.id}`);
  assert.equal(reconstructed.snapshot.class_name, before.snapshot.class_name);
  assert.deepEqual(reconstructed.snapshot.subjects, before.snapshot.subjects);
  const pdf = await fetch(
    `${base}/report-cards/${card.id}?revision=${before.revision}&format=pdf`,
    { headers: { Cookie: clients.principal.cookie } },
  );
  assert.equal(pdf.status, 200);
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
  await request(
    "outsider",
    `/report-cards/${card.id}/revisions`,
    "GET",
    undefined,
    404,
  );
  await request(
    "parent",
    `/report-cards/${card.id}/revisions`,
    "GET",
    undefined,
    403,
  );
  await request(
    "principal",
    "/academics/roster",
    "POST",
    {
      class_id: cls.id,
      term_id: term.id,
      student_id: student.id,
      excluded: true,
      reason: "Remove archived student",
    },
    409,
  );
});

test("term roster corrections, electives and class grading policies respect locks and school boundaries", async () => {
  const payload = {
    class_id: cls.id,
    term_id: term.id,
    student_id: student2.id,
    subject_ids: [assignment.id],
    reason: "Registered elective choices",
  };
  await request("teacher", "/academics/roster", "POST", payload, 403);
  await request("outsider", "/academics/roster", "POST", payload, 404);
  await request("principal", "/academics/roster", "POST", payload);
  const scores = await request(
    "english",
    `/assessments/${englishExam.id}/scores`,
  );
  assert.ok(!scores.students.some((s) => s.id === student2.id));
  await request(
    "english",
    `/assessments/${englishExam.id}/scores`,
    "POST",
    { scores: [{ student_id: student2.id, score: 10 }] },
    422,
  );
  const roster = await request(
      "principal",
      `/academics/roster?class_id=${cls.id}&term_id=${term.id}`,
    ),
    policy = { ...roster.policy.policy, pass_mark: 30 };
  await request("principal", "/academics/class-policy", "POST", {
    class_id: cls.id,
    term_id: term.id,
    label: "Junior programme",
    policy,
    reason: "Programme grading approved",
  });
  const result = await subjectResults(
    db,
    { ...accounts.principal, permissions: ["*"] },
    cls.id,
    term.id,
    { teacherScope: false },
  );
  assert.equal(result.policy.pass_mark, 30);
  assert.equal(
    result.students.find((s) => s.id === student2.id).subjects.length,
    1,
  );
  await request(
    "principal",
    "/academics/class-policy",
    "POST",
    {
      class_id: cls.id,
      term_id: term.id,
      label: "Invalid",
      policy: {
        ...policy,
        grading_scale: [
          { letter: "A", minimum: 70, points: 4 },
          { letter: "F", minimum: 10, points: 0 },
        ],
      },
      reason: "Missing zero threshold",
    },
    422,
  );
});

test("exam timetable rejects overlapping rooms, classes and invigilators and permits adjacent bookings", async () => {
  const body = {
    class_subject_id: assignment.id,
    term_id: term.id,
    exam_date: today,
    start_time: "09:00",
    end_time: "10:00",
    room: "Hall A",
    invigilator_id: accounts.teacher.id,
    reason: "Term exam timetable",
  };
  const first = await request("principal", "/academics/exams", "POST", body);
  await request(
    "principal",
    "/academics/exams",
    "POST",
    {
      ...body,
      class_subject_id: englishAssignment.id,
      room: "Hall B",
      start_time: "09:30",
      end_time: "10:30",
    },
    409,
  );
  await request("principal", "/academics/exams", "POST", {
    ...body,
    start_time: "10:00",
    end_time: "11:00",
  });
  await request("principal", "/academics/exams", "POST", {
    ...body,
    id: first.id,
    room: "Hall C",
  });
  await request(
    "principal",
    "/academics/exams",
    "POST",
    { ...body, exam_date: day(60) },
    422,
  );
  await request("outsider", "/academics/exams", "POST", body, 404);
  assert.equal(
    (await request("teacher", `/academics/exams?term_id=${term.id}`)).length,
    2,
  );
});
