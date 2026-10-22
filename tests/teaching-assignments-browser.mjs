import { openTestDatabase } from "./database.js";
import { chromium } from "@playwright/test";
import express from "express";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { insert } from "../server/db.js";
import { createApp } from "./app.js";
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
  await page.goto(origin + "/login");
  await field("Email address").waitFor();
  const cookies = page.getByRole("button", {
    name: "Accept required cookies",
    exact: true,
  });
  if (await cookies.count()) await cookies.click();
  await field("Email address").fill(`${who}@phase2.test`);
  await page.getByLabel(/^Password \*$/).fill("Phase-two-browser!");
  await click("Sign in to your workspace");
  await page.locator("nav").waitFor();
  if (who === "teacher") {
    await page
      .getByRole("heading", { name: "Your attendance today" })
      .waitFor();
    await click("Close dialog");
  }
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
  const secondClass = await insert(db, "classes", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "Grade 6B",
    capacity: 30,
  });
  await login("principal");
  await navigate("Academics");
  await click("Setup");
  for (const [name, code] of [
    ["Mathematics", "MATH"],
    ["English", "ENG"],
  ]) {
    await click("Add subject");
    await field("Subject name").fill(name);
    await field("Subject code").fill(code);
    await click("Create subject");
    await closed();
  }
  await click("Assign subject");
  await dialog()
    .getByRole("group", { name: "Classes", exact: true })
    .getByLabel("Grade 5A")
    .check();
  await dialog()
    .getByRole("group", { name: "Classes", exact: true })
    .getByLabel("Grade 6B")
    .check();
  await dialog()
    .getByRole("group", { name: "Subjects", exact: true })
    .getByLabel("Mathematics")
    .check();
  await dialog()
    .getByRole("group", { name: "Subjects", exact: true })
    .getByLabel("English")
    .check();
  await field("Teacher").selectOption(String(users.teacher.id));
  await dialog()
    .getByText("4 teaching assignments selected", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/teaching-assignment-selection-desktop.png",
    fullPage: true,
  });
  await click("Save assignments");
  await closed();
  const assignmentPanel = page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", {
        name: "Teaching assignments",
        exact: true,
      }),
    });
  assert.equal(await assignmentPanel.locator("tbody tr").count(), 4);
  await logout();
  await login("teacher");
  await page
    .getByRole("heading", { name: "My classes and subjects", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", {
          name: "My classes and subjects",
          exact: true,
        }),
      })
      .locator("tbody tr")
      .count(),
    4,
  );
  await navigate("Academics");
  await click("New assessment");
  const assessmentSelect = field("Class and subject");
  assert.equal(await assessmentSelect.locator("option").count(), 5);
  const pairs = await assessmentSelect
    .locator("option")
    .evaluateAll((options) =>
      options
        .filter((o) => o.value)
        .map((o) => ({ value: o.value, label: o.textContent })),
    );
  await click("Close dialog");
  for (const pair of pairs) {
    await click("New assessment");
    await field("Class and subject").selectOption(pair.value);
    await field("Assessment name").fill("Multi-class assessment " + pair.value);
    await field("Assessment type").selectOption("TEST");
    await field("Maximum score").fill("10");
    await field("Term weight").fill("20");
    await click("Save assessment");
    await closed();
  }
  await click("Gradebook");
  await page.getByLabel("Gradebook class").selectOption(String(secondClass.id));
  assert.equal(
    await page.getByLabel("Gradebook class").inputValue(),
    String(secondClass.id),
  );
  await navigate("Attendance");
  await page
    .getByLabel("Attendance class")
    .selectOption(String(secondClass.id));
  await navigate("Curriculum");
  assert.equal(
    await page.getByLabel("Curriculum class subject").locator("option").count(),
    5,
  );
  await logout();
  await login("principal");
  await navigate("Curriculum");
  for (const pair of pairs) {
    await click("Plan topic");
    assert.equal(await field("Class and subject").locator("option").count(), 5);
    await field("Class and subject").selectOption(pair.value);
    await field("Topic name").fill("Multi-class topic " + pair.value);
    await field("Planned week").fill("1");
    await field("Sequence order").fill("1");
    await click("Save topic");
    await closed();
  }
  await click("Plan topic");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Curriculum page overflow at ${width}px`,
    );
    const controls = await dialog()
      .locator("input:not([type=checkbox]),select")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          height: n.getBoundingClientRect().height,
          font: getComputedStyle(n).fontSize,
        })),
      );
    assert.ok(
      controls.every((c) => c.height >= 44),
      `Consistent control heights at ${width}px`,
    );
    if (width <= 700)
      assert.ok(
        controls.every((c) => c.font === "16px"),
        "Readable mobile inputs without zoom",
      );
    await page.screenshot({
      path: `test-results/teaching-assignment-form-${width}.png`,
      fullPage: true,
    });
  }
  await click("Close dialog");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await logout();
  assert.deepEqual(errors, []);
  console.log(
    "Teaching assignment browser checks passed: 2 classes x 2 subjects, teacher workspace, all assessment and curriculum options, gradebook, attendance and form consistency at 1440/768/390/320px.",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/teaching-assignment-browser-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
