import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";

const db = await openTestDatabase();
let server, browser;
try {
  const app = await createApp(db);
  const school = await insert(db, "schools", { name: "Public Admissions Academy", short_code: "PUB", portal_slug: "public-academy" });
  const year = await insert(db, "academic_years", { school_id: school.id, name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
  await insert(db, "terms", { school_id: school.id, academic_year_id: year.id, name: "First", start_date: "2026-01-01", end_date: "2026-12-31", is_current: true });
  const classroom = await insert(db, "classes", { school_id: school.id, academic_year_id: year.id, name: "Primary 1", capacity: 30 });
  serveFrontend(app, path.resolve("dist"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // The exact public URL generated in tenant School settings, without login.
  await page.goto(origin + "/?apply=PUB");
  await page.getByLabel("First name").fill("Public");
  await page.getByLabel("Last name").fill("Applicant");
  await page.getByLabel("Gender").selectOption("FEMALE");
  await page.getByLabel("Date of birth").fill("2018-01-01");
  await page.getByLabel("Applying for class").selectOption(String(classroom.id));
  await page.getByLabel("Parent / guardian name").fill("Guardian");
  await page.getByLabel("Guardian phone").fill("08012345678");
  assert.equal(await page.getByLabel("School transportation required").count(), 0);
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.getByRole("heading", { name: "Application received" }).waitFor();
  const student = await one(db, "SELECT * FROM students WHERE school_id=$1", [school.id]);
  assert.equal(student.first_name, "Public");
  assert.equal(student.transportation_required, false);
  assert.equal((await one(db, "SELECT * FROM admission_applications WHERE school_id=$1", [school.id])).stage, "SUBMITTED");
  assert.deepEqual(errors, []);
  console.log("Tenant public admission form loads without login and submits successfully.");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
