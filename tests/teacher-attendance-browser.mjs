import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { digest } from "../server/security.js";

const db = await openTestDatabase();
let server, browser;
try {
  const app = await createApp(db);
  const school = await insert(db, "schools", { name: "Daily Academy", short_code: "DAILY", portal_slug: "daily-academy" });
  const teacher = await insert(db, "users", { school_id: school.id, name: "Daily Teacher", email: "daily@teacher.test", role: "TEACHER", password_hash: "unused" });
  const staff = await insert(db, "staff", { school_id: school.id, user_id: teacher.id, staff_number: "STF-DAILY", first_name: "Daily", last_name: "Teacher", department: "Teaching", position: "Teacher", hire_date: "2026-01-01" });
  const token = "daily-teacher-browser-session";
  await insert(db, "sessions", { user_id: teacher.id, token_hash: digest(token), csrf: token, mfa_verified: true, expires_at: new Date(Date.now() + 300000) });
  serveFrontend(app, path.resolve("dist"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: "smpis_session", value: token, url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/daily-academy/#teaching");
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Your attendance today" }) });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Present", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const record = await one(db, "SELECT * FROM staff_attendance WHERE staff_id=$1", [staff.id]);
  assert.ok(record.check_in_time);
  assert.ok(["PRESENT", "LATE"].includes(record.status));
  const attendanceResponse = page.waitForResponse(response => response.url().includes("/attendance/staff/today") && response.status() === 200);
  await page.reload();
  await page.getByRole("heading", { name: "Teacher workspace", exact: true }).waitFor();
  await attendanceResponse;
  assert.equal(await dialog.count(), 0);
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM staff_attendance WHERE staff_id=$1", [staff.id])).n, 1);
  assert.deepEqual(errors, []);
  console.log("Teacher daily popup records check-in and stays hidden after reload.");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
