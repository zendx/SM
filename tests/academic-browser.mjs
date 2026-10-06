import { openTestDatabase } from "./database.js";
import { chromium } from "@playwright/test";
import express from "express";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { insert } from "../server/db.js";
import { createApp } from "../server/app.js";
import { hashPassword, localClock } from "../server/security.js";
process.env.REQUIRE_MFA = "false";
const db = await openTestDatabase(),
  app = await createApp(db);
const school = await insert(db, "schools", {
    name: "Greenfield Academy",
    short_code: "PH2",
  }),
  users = {};
for (const [name, role] of [
  ["principal", "PRINCIPAL"],
  ["teacher", "TEACHER"],
  ["parent", "PARENT"],
])
  users[name] = await insert(db, "users", {
    school_id: school.id,
    name: humanName(name),
    email: `${name}@phase2.test`,
    role,
    password_hash: hashPassword("Phase-two-browser!"),
  });
function humanName(name) {
  return {
    principal: "Grace Adeyemi",
    teacher: "Mariam Bello",
    parent: "Ada Obi",
  }[name];
}
const today = localClock("Africa/Lagos").date;
const day = (offset) => {
  const value = new Date(`${today}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "2026/2027",
    start_date: day(-180),
    end_date: day(180),
  }),
  term = await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Term 1",
    start_date: day(-90),
    end_date: day(30),
    is_current: true,
  });
const cls = await insert(db, "classes", {
  school_id: school.id,
  academic_year_id: year.id,
  name: "Grade 5A",
  capacity: 30,
  teacher_user_id: users.teacher.id,
});
let child;
for (const [first, last] of [
  ["Amara", "Obi"],
  ["Chinedu", "Eze"],
]) {
  const student = await insert(db, "students", {
    school_id: school.id,
    student_number: `GFA-${first}`,
    first_name: first,
    last_name: last,
    gender: "OTHER",
    date_of_birth: "2016-01-01",
    guardian_name: "Guardian",
    guardian_phone: "08000000000",
    parent_user_id: first === "Amara" ? users.parent.id : null,
    class_id: cls.id,
    status: "ENROLLED",
  });
  if (first === "Chinedu") {
    child = student;
    for (const offset of [-2, -1, 0])
      await insert(db, "student_attendance", {
        school_id: school.id,
        student_id: student.id,
        class_id: cls.id,
        attendance_date: day(offset),
        status: "ABSENT",
        recorded_by: users.teacher.id,
      });
  }
}
app.use(express.static("dist"));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const click = (label) =>
    page.getByRole("button", { name: label, exact: true }).click(),
  field = (name) => page.getByLabel(name, { exact: false }),
  dialog = () => page.locator("dialog");
const navigate = (name) =>
  page.locator("nav").getByRole("button", { name, exact: true }).click();
const closed = () => dialog().waitFor({ state: "hidden" });
async function login(who) {
  await page.goto(origin + '/login');
  await field('Email address').waitFor();
  const cookies=page.getByRole('button',{name:'Accept required cookies',exact:true});
  if(await cookies.count()) await cookies.click();
  await field("Email address").fill(`${who}@phase2.test`);
  await page.getByLabel(/^Password \*$/).fill("Phase-two-browser!");
  await click("Sign in to your workspace");
  await page.locator("nav").waitFor();
}
async function logout() {
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await click("Open navigation");
  await click("Sign out");
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
}
async function createAssessment(name, type, max, weight) {
  await click("New assessment");
  await field("Class and subject").selectOption({ index: 1 });
  await field("Assessment name").fill(name);
  await field("Assessment type").selectOption(type);
  await field("Maximum score").fill(String(max));
  await field("Term weight").fill(String(weight));
  await click("Save assessment");
  await closed();
}
try {
  await login("principal");
  await navigate("Academics");
  await click("Setup");
  await click("Add subject");
  await field("Subject name").fill("Mathematics");
  await field("Subject code").fill("MTH");
  await field("Department").fill("Sciences");
  await click("Create subject");
  await closed();
  await click("Assign subject");
  await dialog()
    .getByLabel("Class", { exact: false })
    .selectOption(String(cls.id));
  await dialog()
    .getByLabel("Subject", { exact: false })
    .first()
    .selectOption({ index: 1 });
  await field("Teacher").last().selectOption(String(users.teacher.id));
  await field("Subject credits").fill("1");
  await click("Save assignment");
  await closed();
  await click("Assessments");
  await createAssessment("Mathematics CA 1", "CA", 20, 40);
  await createAssessment("Mathematics examination", "EXAM", 60, 60);
  await navigate("Curriculum");
  await click("Import CSV");
  await field("Curriculum CSV file").setInputFiles({
    name: "mathematics.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'topic_name,planned_week,sequence_order\n"Fractions, ratios",1,1\nGeometry,2,2',
    ),
  });
  await dialog().getByLabel("Class and subject").selectOption({ index: 1 });
  await click("Import topics");
  await closed();
  await page.getByText("Fractions, ratios", { exact: true }).waitFor();
  await logout();
  await login("teacher");
  await navigate("Academics");
  await page
    .getByRole("row")
    .filter({ hasText: "Mathematics CA 1" })
    .getByRole("button", { name: "Enter scores", exact: true })
    .click();
  await field("Score for Amara Obi").fill("21");
  await field("Score for Chinedu Eze").fill("8");
  await click("Save scores");
  await page
    .getByText("Score for Amara exceeds the maximum of 20.00.", { exact: true })
    .waitFor();
  await field("Score for Amara Obi").fill("16");
  await click("Save scores");
  await closed();
  await page
    .getByRole("row")
    .filter({ hasText: "Mathematics examination" })
    .getByRole("button", { name: "Enter scores", exact: true })
    .click();
  await field("Score for Amara Obi").fill("45");
  await field("Score for Chinedu Eze").fill("20");
  await click("Save scores");
  await closed();
  await click("Gradebook");
  await page.getByRole("cell", { name: "77% · A", exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/academic-gradebook.png",
    fullPage: true,
  });
  await navigate("Curriculum");
  await page
    .getByRole("row")
    .filter({ hasText: "Fractions, ratios" })
    .getByRole("button", { name: "Log teaching" })
    .click();
  await field("Completion status").selectOption("PARTIAL");
  await click("Save teaching log");
  await page
    .getByText("Incomplete topics require a reason.", { exact: true })
    .waitFor();
  await field("Completion status").selectOption("COMPLETED");
  await click("Save teaching log");
  await closed();
  await click("Coverage");
  await page.getByRole("cell", { name: "50%", exact: true }).first().waitFor();
  await page.screenshot({
    path: "test-results/curriculum-desktop.png",
    fullPage: true,
  });
  await logout();
  await login("parent");
  await navigate("Academic results");
  await page
    .getByRole("heading", { name: "No published results yet" })
    .waitFor();
  await logout();
  await login("principal");
  await navigate("Academics");
  await click("Report Cards");
  await click("Generate reports");
  await field("Class").last().selectOption(String(cls.id));
  await click("Generate drafts");
  await closed();
  await page
    .getByRole("row")
    .filter({ hasText: "Amara Obi" })
    .getByRole("button", { name: "View report" })
    .click();
  await field("Teacher comment").fill(
    "Consistent effort and a strong understanding of fractions.",
  );
  await field("Principal comment").fill("Keep up the good work.");
  await click("Save comments");
  await dialog()
    .getByText(/^Average: 77(?:\.00)?%$/)
    .waitFor();
  await click("Close dialog");
  await click("Finalize results");
  await page
    .getByRole("button", { name: "Publish reports", exact: true })
    .waitFor();
  await click("Publish reports");
  await page
    .locator("tbody")
    .getByText("Published", { exact: true })
    .first()
    .waitFor();
  await click("Analytics");
  await page
    .getByRole("heading", { name: "Students needing academic support" })
    .waitFor();
  await page.getByText(/^Low Attendance And Performance/).waitFor();
  await page.screenshot({
    path: "test-results/academic-analytics.png",
    fullPage: true,
  });
  await field("Academic report format").selectOption("xlsx");
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  assert.match((await exportPromise).suggestedFilename(), /subjects.*xlsx$/);
  await logout();
  await login("parent");
  await navigate("Academic results");
  await page
    .getByRole("button", { name: "View report", exact: true })
    .waitFor();
  assert.equal(await page.getByText("Chinedu Eze", { exact: true }).count(), 0);
  await click("View report");
  await dialog()
    .getByText("Consistent effort and a strong understanding of fractions.", {
      exact: true,
    })
    .waitFor();
  const pdfPromise = page.waitForEvent("download");
  await click("Download PDF");
  assert.match((await pdfPromise).suggestedFilename(), /report-.*pdf$/);
  await page.screenshot({
    path: "test-results/parent-report.png",
    fullPage: true,
  });
  await click("Close dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/academic-mobile.png",
    fullPage: true,
  });
  await logout();
  assert.deepEqual(errors, []);
  console.log(
    "Phase 2 browser workflow passed: manager setup, assigned-teacher score entry/validation, weighted gradebook, CSV plan import, teaching logs, draft/finalize/publish, risk analytics, Excel export, parent publication gate, PDF download and mobile layout.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/academic-browser-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
