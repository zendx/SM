import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "../tests/database.js";
import { createApp } from "../server/app.js";
import { insert } from "../server/db.js";
import { digest, hashPassword } from "../server/security.js";

process.env.SMPIS_TEST_EMBEDDED = "true";
process.env.REQUIRE_MFA = "false";
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const dry = process.argv.includes("--dry-run");
const root = path.resolve(".");
const output = path.join(root, "docs", "marketing-video-mobile");
await mkdir(path.join(output, "recordings"), { recursive: true });
await mkdir(path.join(output, "review"), { recursive: true });

const db = await openTestDatabase();
const app = await createApp(db);
const school = await insert(db, "schools", {
  name: "Greenfield Academy",
  short_code: "GFA",
  portal_slug: "school-gfa",
});
const year = await insert(db, "academic_years", {
  school_id: school.id,
  name: "2026 / 2027",
  start_date: "2026-09-01",
  end_date: "2027-07-31",
});
const term = await insert(db, "terms", {
  school_id: school.id,
  academic_year_id: year.id,
  name: "First Term",
  start_date: "2026-09-01",
  end_date: "2026-12-18",
  is_current: true,
});
async function account(name, email, role) {
  return insert(db, "users", {
    school_id: school.id,
    name,
    email,
    role,
    password_hash: hashPassword("Demo-password-2026!"),
    email_verified: true,
  });
}
const admin = await account(
  "School Administrator",
  "admin@greenfield.example",
  "SUPER_ADMIN",
);
await insert(db, "platform_operators", { user_id: admin.id });
const teacher = await account(
  "Grace Adeyemi",
  "grace@greenfield.example",
  "TEACHER",
);
const classes = [];
for (const name of ["Primary 3", "Primary 4", "Primary 5"]) {
  classes.push(
    await insert(db, "classes", {
      school_id: school.id,
      academic_year_id: year.id,
      name,
      capacity: 30,
      teacher_user_id: teacher.id,
    }),
  );
}
for (const [index, [first, last]] of [
  ["Amara", "Obi"],
  ["Chidi", "Obi"],
  ["Kemi", "Adeleke"],
  ["Daniel", "Okafor"],
  ["Zara", "Bello"],
  ["Tomi", "Adeyemi"],
].entries()) {
  const student = await insert(db, "students", {
    school_id: school.id,
    student_number: `GFA-${String(index + 1).padStart(4, "0")}`,
    first_name: first,
    last_name: last,
    gender: index % 2 ? "MALE" : "FEMALE",
    date_of_birth: "2016-04-12",
    guardian_name: "Demo Guardian",
    guardian_phone: "+2348000000000",
    guardian_email: "guardian@example.test",
    status: "ENROLLED",
    class_id: classes[index < 4 ? 0 : 1].id,
  });
  await insert(db, "student_enrollment", {
    school_id: school.id,
    student_id: student.id,
    class_id: student.class_id,
    enrollment_date: "2026-09-01",
    status: "ACTIVE",
  });
  for (let day = 1; day <= 3; day++) {
    await insert(db, "student_attendance", {
      school_id: school.id,
      student_id: student.id,
      class_id: student.class_id,
      attendance_date: `2026-10-0${day}`,
      status: "PRESENT",
      recorded_by: teacher.id,
    });
  }
}
for (const cls of classes) {
  await insert(db, "fee_structures", {
    school_id: school.id,
    class_id: cls.id,
    term_id: term.id,
    fee_category: "TUITION",
    amount_cents: 12000000,
  });
}

app.use(
  "/promo-assets",
  express.static(path.join(root, "docs", "marketing-video", "assets")),
);
app.get("/promo-logo.png", (req, res) =>
  res.sendFile(path.join(root, "src", "assets", "smpis-logo.png")),
);
const html = await readFile(path.join(output, "stage-source.html"), "utf8");
app.get("/promo", (req, res) => res.type("html").send(html));
app.use(express.static(path.join(root, "dist")));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.join(root, "dist", "index.html")),
);

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const token = randomBytes(20).toString("hex");
await insert(db, "sessions", {
  user_id: admin.id,
  token_hash: digest(token),
  csrf: token,
  mfa_verified: true,
  expires_at: new Date(Date.now() + 3600000),
});
const context = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  ...(dry
    ? {}
    : {
        recordVideo: {
          dir: path.join(output, "recordings"),
          size: { width: 1080, height: 1920 },
        },
      }),
});
await context.addCookies([
  {
    name: "smpis_session",
    value: token,
    url: origin,
    httpOnly: true,
    sameSite: "Lax",
  },
]);
const page = await context.newPage();
page.setDefaultTimeout(9000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const portal = () => page.frameLocator("#portal");
const navButton = (name) =>
  portal().locator("nav").getByRole("button", { name, exact: true });

async function pointer(locator, click = false) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Cannot find the mobile interaction target.");
  const x = box.x + Math.min(box.width * 0.56, 230);
  const y = box.y + Math.min(box.height * 0.55, 44);
  await page.evaluate(([px, py]) => window.point(px, py), [x, y]);
  await page.mouse.move(x, y, { steps: 8 });
  await page.waitForTimeout(dry ? 10 : 220);
  if (click) {
    await page.evaluate(([px, py]) => window.tap(px, py), [x, y]);
    await locator.click();
  }
}

async function at(second, action) {
  if (!dry) {
    const remaining = second * 1000 - (performance.now() - start);
    if (remaining > 0) await page.waitForTimeout(remaining);
  }
  await action();
  if (!dry && (performance.now() - start) / 1000 > second + 2.5) {
    console.log(`Timing note at ${second}s.`);
  }
}

async function openNavigation(label) {
  await pointer(
    portal().getByRole("button", { name: "Open navigation", exact: true }),
    true,
  );
  await pointer(navButton(label), true);
  if (!dry) await page.waitForTimeout(350);
}

let start;
try {
  await page.goto(`${origin}/promo`);
  await page.evaluate(() =>
    document.getElementById("phone").classList.add("visible"),
  );
  await portal().getByLabel("School name").waitFor();
  await page.evaluate(() => window.startProgress());
  await page.screenshot({
    path: path.join(output, "review", "intro.png"),
  });
  start = performance.now();

  await at(6, async () => {
    await page.evaluate(() =>
      window.showStep({
        number: 1,
        kicker: "STEP 1 · CREATE YOUR SCHOOL PORTAL",
        title: "Choose your school’s address.",
        step: "Choose a unique portal name",
        note: "Then add your first administrator.",
        caption: "Use a short, memorable address for your school.",
      }),
    );
    const cookies = portal().getByRole("button", {
      name: "Accept required cookies",
      exact: true,
    });
    if (await cookies.isVisible().catch(() => false)) await cookies.click();
  });
  await at(8, async () => {
    const schoolName = portal().getByLabel("School name");
    await pointer(schoolName, true);
    await schoolName.fill("Greenfield Academy");
    const slug = portal().getByLabel("School portal name");
    await pointer(slug);
    await slug.fill("greenfield-academy");
  });
  await at(12, async () => {
    const name = portal().getByLabel("Administrator name");
    await pointer(name);
    await name.fill("Amina Bello");
    const email = portal().getByLabel("Administrator email");
    await pointer(email);
    await email.fill("admin@greenfield.example");
    await page.screenshot({
      path: path.join(output, "review", "signup.png"),
    });
  });

  await at(15, async () => {
    await page.evaluate(() =>
      window.showStep({
        number: 2,
        kicker: "STEP 2 · START WITH THE FREE TRIAL",
        title: "Set your school year and dates.",
        step: "Select Free · 30-day trial",
        note: "Add the academic year and the dates you use.",
        caption: "No card is required to start.",
      }),
    );
    const plan = portal().getByLabel("Plan");
    await pointer(plan);
    await plan.selectOption("FREE");
    const yearField = portal().getByLabel("Academic year");
    await pointer(yearField);
    await yearField.fill("2026 / 2027");
    await page.screenshot({
      path: path.join(output, "review", "trial-and-year.png"),
    });
  });

  await at(20, async () => {
    await page.evaluate(() => window.prepareWorkspace());
    await page
      .frameLocator("#workspace-prefetch")
      .locator("nav")
      .waitFor({ state: "attached" });
  });

  await at(22, async () => {
    await page.evaluate(() => {
      window.setPortal("/school-gfa/#dashboard");
      window.showStep({
        number: 3,
        kicker: "STEP 3 · BUILD YOUR CLASS LIST",
        title: "Start with the classes you run.",
        step: "Add classes and their capacity",
        note: "Assign the right academic year to each class.",
        caption: "Open Administration → Classes → New class.",
      });
    });
    await portal().locator("nav").waitFor();
  });
  await at(24, async () => {
    await openNavigation("Administration");
    await portal()
      .getByRole("heading", { name: "Administration", exact: true })
      .waitFor();
    await pointer(
      portal()
        .locator(".tabs")
        .getByRole("button", { name: "Classes", exact: true }),
      true,
    );
  });
  await at(27, async () => {
    await pointer(
      portal().getByRole("button", { name: "New class", exact: true }),
      true,
    );
    const name = portal().getByLabel("Class name");
    await pointer(name);
    await name.fill("Primary 1");
    const capacity = portal().getByLabel("Capacity");
    await pointer(capacity);
    await capacity.fill("30");
    const academicYear = portal().getByLabel("Academic year");
    await pointer(academicYear);
    await academicYear.selectOption(String(year.id));
  });
  await at(31, async () => {
    await pointer(
      portal()
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true }),
      true,
    );
    await page.screenshot({
      path: path.join(output, "review", "classes.png"),
    });
  });

  await at(32, async () => {
    await page.evaluate(() =>
      window.showStep({
        number: 4,
        kicker: "STEP 4 · SET UP YOUR TEAM",
        title: "Give every colleague a role.",
        step: "Create separate staff accounts",
        note: "Then assign each teacher to their class.",
        caption: "Keep access personal—never share the administrator login.",
      }),
    );
    await pointer(
      portal()
        .locator(".tabs")
        .getByRole("button", { name: "Users", exact: true }),
      true,
    );
    await pointer(
      portal().getByRole("button", { name: "Create account", exact: true }),
      true,
    );
  });
  await at(35, async () => {
    const name = portal().getByLabel("Full name");
    await pointer(name);
    await name.fill("Grace Adeyemi");
    const email = portal().getByLabel("Email address");
    await pointer(email);
    await email.fill("grace@greenfield.example");
    const role = portal().getByLabel("Role");
    await pointer(role);
    await role.selectOption({ label: "Teacher" });
    await page.screenshot({
      path: path.join(output, "review", "team-account.png"),
    });
  });

  await at(41, async () => {
    await page.evaluate(() =>
      window.showStep({
        number: 5,
        kicker: "STEP 5 · BRING SCHOOL LIFE TOGETHER",
        title: "Add learners, then set up fees.",
        step: "Add student records and class fees",
        note: "Choose the correct term before setting fees.",
        caption: "Your team can record attendance and track progress, too.",
      }),
    );
    await portal()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await openNavigation("Students");
    await portal().getByRole("heading", { name: "Students", exact: true }).waitFor();
    await page.screenshot({
      path: path.join(output, "review", "students.png"),
    });
  });
  await at(44, async () => {
    await openNavigation("Finance");
    await portal().getByRole("heading", { name: "Finance", exact: true }).waitFor();
    await pointer(
      portal().getByRole("button", { name: "Fee Structures", exact: true }),
      true,
    );
    await pointer(portal().getByRole("button", { name: "Set fee", exact: true }), true);
  });
  await at(46, async () => {
    const dialog = portal().getByRole("dialog");
    const classField = dialog.getByLabel("Class", { exact: false });
    await pointer(classField);
    await classField.selectOption(String(classes[0].id));
    const category = dialog.getByLabel("Fee category");
    await pointer(category);
    await category.selectOption("TUITION");
    const amount = dialog.getByLabel("Amount (NGN)");
    await pointer(amount);
    await amount.fill("120000");
  });
  await at(48, async () => {
    await pointer(
      portal()
        .getByRole("dialog")
        .getByRole("button", { name: "Save", exact: true }),
      true,
    );
    await page.screenshot({
      path: path.join(output, "review", "fees.jpg"),
      type: "jpeg",
      quality: 90,
    });
  });
  await at(49, async () => {
    await page.evaluate(() => window.finish());
  });
  await at(55, async () => {
    await page.screenshot({
      path: path.join(output, "SMPIS-Quick-Start-Poster.jpg"),
      type: "jpeg",
      quality: 94,
    });
  });
  await at(60, async () => {});

  if (errors.length) throw new Error(errors.join("\n"));
  if (!dry) {
    const video = page.video();
    await page.close();
    await video.saveAs(
      path.join(output, "recordings", "mobile-quick-start.webm"),
    );
  }
  await writeFile(
    path.join(output, "validation.json"),
    JSON.stringify(
      {
        duration_seconds: 60,
        resolution: "1080x1920",
        frame_rate: 30,
        orientation: "portrait",
        signup_submission: false,
        demo_records: "fictional; isolated embedded test database",
        narration: "Microsoft Zira Desktop; generated locally",
      },
      null,
      2,
    ),
  );
  console.log(
    dry
      ? "Mobile walkthrough and layouts checked."
      : "Recorded the 60-second portrait product walkthrough.",
  );
} catch (error) {
  await page.evaluate(() =>
    document.getElementById("intro").classList.add("hidden"),
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(output, "review", "capture-error.png"),
  });
  console.error((await page.locator("body").innerText()).slice(0, 1200));
  console.error("Portal screen:", (await portal().locator("body").innerText()).slice(0, 1200));
  if (errors.length) console.error("Browser errors:", errors.join("\n"));
  throw error;
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
