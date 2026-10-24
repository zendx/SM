import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const db = await openTestDatabase();
const app = await createApp(db);
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
try {
  const school = await insert(db, "schools", {
    name: "Greenfield Academy",
    short_code: "PMTEST",
    portal_slug: "greenfield",
  });
  const password = "Parent-message-browser-2026!";
  const admin = await insert(db, "users", {
    school_id: school.id,
    name: "School administrator",
    email: "admin@pm.test",
    role: "SUPER_ADMIN",
    password_hash: hashPassword(password),
    email_verified: true,
  });
  const year = await insert(db, "academic_years", {
    school_id: school.id,
    name: "2026/27",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  });
  await insert(db, "terms", {
    school_id: school.id,
    academic_year_id: year.id,
    name: "First term",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    is_current: true,
  });
  const parents = [];
  for (const [index, name, child] of [
    [0, "Ada Okafor", "Amara"],
    [1, "Ibrahim Bello", "Zainab"],
    [2, "Grace Adeyemi", "Daniel"],
  ]) {
    const p = await insert(db, "users", {
      school_id: school.id,
      name,
      email: `parent${index}@pm.test`,
      role: "PARENT",
      password_hash: hashPassword(password),
      email_verified: true,
    });
    parents.push(p);
    const cls = await insert(db, "classes", {
      school_id: school.id,
      academic_year_id: year.id,
      name: `Primary ${index + 1}`,
      capacity: 30,
    });
    await insert(db, "students", {
      school_id: school.id,
      parent_user_id: p.id,
      class_id: cls.id,
      first_name: child,
      last_name: name.split(" ")[1],
      gender: "OTHER",
      date_of_birth: "2017-01-01",
      guardian_name: name,
      guardian_phone: "08000000000",
      status: "ENROLLED",
    });
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await page.request.post(origin + "/api/v1/auth/login", {
    data: { email: admin.email, password },
  });
  assert.equal(login.status(), 200, await login.text());
  await page.goto(origin + "/greenfield/#messages");
  await expect(
    page.getByRole("heading", { name: "New message" }),
  ).toBeVisible();
  const cookies = page.getByRole("button", {
    name: "Accept required cookies",
    exact: true,
  });
  if (await cookies.isVisible()) await cookies.click();
  await page.getByLabel("Search parents").fill("Amara");
  await expect(page.locator(".pm-parent")).toHaveCount(1);
  await page.locator(".pm-parent input").check();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Parent meeting on Friday");
  await page
    .getByLabel("Message", { exact: true })
    .fill(
      "Dear parents,\nPlease join us this Friday at 10am in the school hall. We look forward to seeing you.",
    );
  await mkdir("test-results/parent-messages", { recursive: true });
  await page.screenshot({
    path: "test-results/parent-messages/desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Review message", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Ada Okafor");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    "Parent meeting on Friday",
  );
  await page.getByRole("radio", { name: /A class/ }).check();
  await page
    .getByLabel("Class", { exact: true })
    .selectOption({ label: "Primary 2" });
  await page
    .getByRole("button", { name: "Review message", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Primary 2");
  await page
    .getByRole("button", { name: "Send to 1 parent", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Message sent to 1 parent",
  );
  const notification = await one(
    db,
    "SELECT user_id,body FROM notifications WHERE title='Parent meeting on Friday'",
  );
  assert.equal(notification.user_id, parents[1].id);
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("");
  await page.getByRole("radio", { name: /All parents/ }).check();
  await page.getByLabel("Subject", { exact: true }).fill("End of term update");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Thank you for a wonderful term. School closes on Friday.");
  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile horizontal overflow",
    );
    await page.screenshot({
      path: `test-results/parent-messages/mobile-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Review message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Send to 3 parents", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/parent-messages/review-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Keep editing" }).click();
  }
  await page.route("**/api/v1/parent-messages", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        errors: [{ message: "Delivery temporarily unavailable. Try again." }],
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Review message", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send to 3 parents", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Delivery temporarily unavailable",
  );
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(
    "End of term update",
  );
  await page.unroute("**/api/v1/parent-messages");
  await page.route("**/api/v1/parent-messages/recipients", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
  await page.reload();
  await expect(
    page.getByText("No parent accounts yet", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review message", exact: true }),
  ).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log(
    "Parent messaging passed: child search, individual selection, class delivery, preview editing, all-parent audience, desktop and mobile layouts.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
