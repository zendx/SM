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
  app = await createApp(db),
  school = await insert(db, "schools", {
    name: "Greenfield Academy",
    short_code: "GFA",
  }),
  users = {};
const password = "Browser-operations-pass!",
  today = localClock("Africa/Lagos").date,
  day = (n) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
for (const [name, role] of [
  ["admin", "SUPER_ADMIN"],
  ["teacher", "TEACHER"],
  ["unassigned_teacher", "TEACHER"],
  ["parent", "PARENT"],
])
  users[name] = await insert(db, "users", {
    school_id: school.id,
    name: {
      admin: "Grace Adeyemi",
      teacher: "Mariam Bello",
      unassigned_teacher: "Tunde Okafor",
      parent: "Ada Obi",
    }[name],
    role,
    email: `${name}@opsbrowser.test`,
    password_hash: hashPassword(password),
  });
await insert(db, "platform_operators", { user_id: users.admin.id });
const year = await insert(db, "academic_years", {
  school_id: school.id,
  name: "Current year",
  start_date: day(-60),
  end_date: day(300),
});
await insert(db, "terms", {
  school_id: school.id,
  academic_year_id: year.id,
  name: "Term 1",
  start_date: day(-60),
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
await insert(db, "students", {
  school_id: school.id,
  first_name: "Amara",
  last_name: "Obi",
  date_of_birth: "2016-01-01",
  gender: "OTHER",
  guardian_name: "Ada Obi",
  guardian_phone: "08000000000",
  class_id: cls.id,
  parent_user_id: users.parent.id,
  status: "ENROLLED",
});
const staff = await insert(db, "staff", {
  school_id: school.id,
  user_id: users.teacher.id,
  staff_number: "ST-001",
  first_name: "Mariam",
  last_name: "Bello",
  department: "Sciences",
  position: "Teacher",
  hire_date: day(-60),
});
app.use(express.static("dist"));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
});
const click = (label) =>
    page.getByRole("button", { name: label, exact: true }).click(),
  field = (label) => page.getByLabel(label, { exact: false }),
  nav = (name) =>
    page.locator("nav").getByRole("button", { name, exact: true }).click(),
  dialog = () => page.locator("dialog"),
  closed = () => dialog().waitFor({ state: "hidden" });
async function login(who) {
  await page.goto(origin + '/login');
  await field('Email address').waitFor();
  const cookies=page.getByRole('button',{name:'Accept required cookies',exact:true});
  if(await cookies.count()) await cookies.click();
  await field("Email address").fill(`${who}@opsbrowser.test`);
  await page.getByLabel(/^Password \*$/).fill(password);
  await click("Sign in to your workspace");
  await page.locator("nav").waitFor();
}
async function logout() {
  await click("Sign out");
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
}
async function progress(label, note = "Reviewed and recorded.") {
  await click(`Next: ${label}`);
  await dialog().locator("textarea").fill(note);
  await click("Record progress");
  await page
    .getByRole("button", { name: "Back to history", exact: true })
    .waitFor({ state: "hidden" });
}
try {
  await login("admin");
  await nav("Facilities & assets");
  await click("Facilities");
  await click("Add facility");
  await field("Facility name").fill("Science laboratory");
  await field("Facility category").selectOption("LABORATORY");
  await field("Location").fill("Block B");
  await field("Condition").selectOption("GOOD");
  await click("Save");
  await closed();
  await page
    .getByRole("cell", { name: "Science laboratory", exact: true })
    .waitFor();
  await click("Maintenance");
  await click("New maintenance");
  await field("Category").selectOption("SAFETY");
  await field("Description").fill("Repair the laboratory electrical socket.");
  await field("Priority").selectOption("URGENT");
  await field("Facility").selectOption({ index: 1 });
  await click("Submit case");
  await closed();
  await click("View case");
  await click("Assign case");
  await field("Responsible staff").selectOption(String(users.admin.id));
  await click("Save assignment");
  await progress("Assigned");
  await progress("In Progress");
  await progress("Completed");
  await click("Next: Cost Recorded");
  await field("Progress note").fill("Repair under warranty.");
  await field("Repair cost").fill("0");
  await click("Record progress");
  await page
    .getByRole("button", { name: "Next: Closed", exact: true })
    .waitFor();
  await progress("Closed", "Inspection passed; socket is safe.");
  await page.screenshot({
    path: "test-results/maintenance-history.png",
    fullPage: true,
  });
  await click("Close dialog");
  await nav("People & HR");
  await click("Profiles");
  await click("Edit HR profile");
  await field("Supervisor").selectOption(String(users.admin.id));
  await field("Qualifications").fill("BEd Science");
  await click("Save");
  await closed();
  await click("Vacancies");
  await click("Add vacancy");
  await field("Job title").fill("Mathematics teacher");
  await field("Department").fill("Sciences");
  await field("Job description").fill(
    "Teach mathematics in junior secondary school.",
  );
  await field("Closing date").fill(day(30));
  await click("Save");
  await closed();
  await click("Applicants");
  await click("Add applicant");
  await field("Vacancy").selectOption({ index: 1 });
  await field("First name").fill("James");
  await field("Last name").fill("Okoro");
  await dialog().getByLabel("Email").fill("james@example.test");
  await field("Phone").fill("08000000001");
  await field("Qualifications").fill("BEd Mathematics");
  await click("Save");
  await closed();
  for (const stage of ["SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED"]) {
    await click("Progress applicant");
    await field("Next recruitment stage").selectOption(stage);
    await field("Evaluation / decision note").fill(
      "Interview and references recorded.",
    );
    if (stage === "INTERVIEW")
      await field("Interview date").fill(`${day(1)}T10:00`);
    if (stage === "HIRED") await field("Hire date").fill(day(7));
    await click("Save");
    await closed();
  }
  await page.getByText("Hired", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/hr-recruitment.png",
    fullPage: true,
  });
  await nav("School experience");
  await click("Surveys");
  await click("Create survey");
  await field("Survey title").fill("Term feedback");
  await field("End date").fill(day(30));
  await dialog()
    .getByRole("button", { name: "Create survey", exact: true })
    .click();
  await closed();
  await logout();
  await login("teacher");
  await page
    .getByRole("heading", { name: "Teacher workspace", exact: true })
    .waitFor();
  await page.getByRole("cell", { name: "Grade 5A", exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Teacher workspace", exact: true })
    .waitFor();
  await page.getByRole("cell", { name: "Grade 5A", exact: true }).waitFor();
  await logout();
  await login("unassigned_teacher");
  await page
    .getByRole("heading", { name: "Teacher workspace", exact: true })
    .waitFor();
  await page
    .getByText("No classes or subjects are assigned yet", { exact: true })
    .waitFor();
  await logout();
  await login("teacher");
  await nav("People & HR");
  await click("Request leave");
  await field("Leave start").fill(day(2));
  await field("Leave end").fill(day(3));
  await field("Reason for leave").fill("Family appointment.");
  await click("Save");
  await closed();
  await page.getByText("Requested", { exact: true }).waitFor();
  await nav("School experience");
  await click("New discipline");
  await field("Category").selectOption("LATENESS");
  await field("Description").fill("Repeated late arrival, for review.");
  await field("Priority").selectOption("NORMAL");
  await field("Student").selectOption({ index: 1 });
  await click("Submit case");
  await closed();
  await logout();
  await login("parent");
  await nav("School experience");
  await click("New complaint");
  await field("Category").selectOption("COMMUNICATION");
  await field("Description").fill("Please clarify the parent meeting date.");
  await field("Priority").selectOption("NORMAL");
  await click("Submit case");
  await closed();
  await page.getByRole("cell", { name: "Submitted", exact: true }).waitFor();
  await click("Surveys");
  await click("Answer survey");
  for (const select of await dialog().locator("select").all())
    await select.selectOption("4");
  await click("Submit answers");
  await closed();
  await page.getByText("Answered", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/parent-feedback.png",
    fullPage: true,
  });
  await logout();
  await login("admin");
  await nav("People & HR");
  await click("Review leave");
  await field("Decision").first().selectOption("REVIEWED");
  await field("Decision note").fill("Class cover arranged.");
  await click("Save");
  await closed();
  await click("Review leave");
  await field("Decision").first().selectOption("APPROVED");
  await field("Decision note").fill("Approved and recorded.");
  await click("Save");
  await closed();
  await page.getByText("Approved", { exact: true }).waitFor();
  await click("Reviews");
  await click("Add review");
  await field("Staff member").selectOption(String(staff.id));
  await field("Academic year").selectOption(String(year.id));
  await field("Professional development score").fill("80");
  await field("Review evidence").fill(
    "Training evidence reviewed; attendance data pending.",
  );
  await click("Save");
  await closed();
  await click("View review");
  await page.getByText("No data", { exact: true }).first().waitFor();
  await click("Close dialog");
  await nav("School experience");
  await click("Complaints");
  await click("View case");
  await click("Assign case");
  await field("Responsible staff").selectOption(String(users.admin.id));
  await click("Save assignment");
  for (const stage of [
    "Acknowledged",
    "Assigned",
    "Investigated",
    "Response Provided",
    "Resolved",
  ])
    await progress(stage, "The meeting date has been confirmed.");
  await click("Close dialog");
  await click("Surveys");
  await click("View results");
  await page.getByText("1 parent responses", { exact: true }).waitFor();
  await click("Close dialog");
  await nav("Intelligence");
  await page
    .getByRole("heading", { name: "Awaiting historical data", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/intelligence-desktop.png",
    fullPage: true,
  });
  // A school administrator without platform designation must not mount this page.
  await db.query("DELETE FROM platform_operators WHERE user_id=$1", [users.admin.id]);
  const platformRequests = [];
  const recordPlatformRequest = (request) => {
    if (request.url().includes("/api/v1/saas/owner")) platformRequests.push(request.url());
  };
  page.on("request", recordPlatformRequest);
  await page.goto(`${origin}/?permission-route-test=1#platform`);
  await page.waitForFunction(() => location.hash === "#dashboard");
  await page.locator("nav").waitFor();
  assert.equal(await page.locator("nav").getByRole("button", { name: "SaaS business", exact: true }).count(), 0);
  assert.deepEqual(platformRequests, []);
  page.off("request", recordPlatformRequest);
  await insert(db, "platform_operators", { user_id: users.admin.id });
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "SaaS business", exact: true }).waitFor();
  await nav("SaaS business");
  await click("Create school portal");
  await field("School name").fill("Oakridge School");
  await field("School portal name").fill("oakridge-school");
  await field("Administrator name").fill("Oakridge Administrator");
  await field("Administrator email").fill("oak@example.test");
  await field("Administrator password").fill("Oakridge-initial-pass!");
  await field("Academic year").fill("Next school year");
  await field("Year starts").fill(today);
  await field("Year ends").fill(day(365));
  await click("Create school");
  await closed();
  await page
    .getByRole("cell", { name: "Oakridge School", exact: false })
    .waitFor();
  await page.screenshot({
    path: "test-results/school-portfolio.png",
    fullPage: true,
  });
  await nav("Intelligence");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/intelligence-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Operations browser workflow passed: facilities/repair closure, hiring, leave approval, discipline reporting, parent complaint/survey, performance review, intelligence data gate, school provisioning and mobile layout.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/operations-browser-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
