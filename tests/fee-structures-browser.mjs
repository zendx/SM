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
  const school = await insert(db, "schools", { name: "Fee Academy", short_code: "FEES", portal_slug: "fee-academy" });
  const user = await insert(db, "users", { school_id: school.id, name: "Finance Officer", email: "finance@fees.test", role: "FINANCE_OFFICER", password_hash: "unused" });
  const year = await insert(db, "academic_years", { school_id: school.id, name: "2026", start_date: "2026-01-01", end_date: "2026-12-31" });
  const terms = [];
  for (const [name, start, end, current] of [["First", "2026-01-01", "2026-04-30", true], ["Second", "2026-05-01", "2026-08-31", false]]) {
    terms.push(await insert(db, "terms", { school_id: school.id, academic_year_id: year.id, name, start_date: start, end_date: end, is_current: current }));
  }
  const classes = [];
  for (const name of ["Primary 1", "Primary 2", "Primary 3"]) classes.push(await insert(db, "classes", { school_id: school.id, academic_year_id: year.id, name, capacity: 30 }));
  for (const [classIndex, termIndex, fee_category, amount_cents] of [[0, 0, "TUITION", 100000], [0, 0, "BOOKS", 20000], [0, 1, "TUITION", 110000], [1, 0, "EXAM", 30000]]) {
    await insert(db, "fee_structures", { school_id: school.id, class_id: classes[classIndex].id, term_id: terms[termIndex].id, fee_category, amount_cents });
  }
  const token = "fee-structures-browser-session";
  await insert(db, "sessions", { user_id: user.id, token_hash: digest(token), csrf: token, mfa_verified: true, expires_at: new Date(Date.now() + 300000) });
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
  await page.goto(origin + "/fee-academy/#finance");
  await page.getByRole("button", { name: "Fee Structures", exact: true }).click();
  await page.getByText("Choose a class to view its fees", { exact: true }).waitFor();
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Fee Structures", exact: true }) });
  await panel.getByLabel("Class", { exact: true }).selectOption(String(classes[0].id));
  await panel.getByRole("cell", { name: "Books", exact: true }).waitFor();
  assert.equal(await panel.locator("tbody tr").count(), 3);
  assert.equal(await panel.getByRole("columnheader", { name: "Class", exact: true }).count(), 0);
  await panel.getByLabel("Term", { exact: true }).selectOption(String(terms[0].id));
  assert.equal(await panel.locator("tbody tr").count(), 2);
  await panel.getByRole("row").filter({ hasText: "Books" }).getByRole("button", { name: "Edit fee" }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.getByLabel("Class", { exact: false }).inputValue(), String(classes[0].id));
  assert.equal(await dialog.getByLabel("Term", { exact: false }).inputValue(), String(terms[0].id));
  await dialog.getByLabel("Amount").fill("250");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(Number((await one(db, "SELECT amount_cents FROM fee_structures WHERE class_id=$1 AND term_id=$2 AND fee_category='BOOKS'", [classes[0].id, terms[0].id])).amount_cents), 25000);
  await panel.getByLabel("Class", { exact: true }).selectOption(String(classes[1].id));
  await panel.getByRole("cell", { name: "Exam", exact: true }).waitFor();
  assert.equal(await panel.locator("tbody tr").count(), 1);
  await panel.getByLabel("Class", { exact: true }).selectOption(String(classes[2].id));
  await panel.getByText("No fees set yet", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Set fee", exact: true }).click();
  assert.equal(await dialog.getByLabel("Class", { exact: false }).inputValue(), String(classes[2].id));
  assert.deepEqual(errors, []);
  console.log("Fee structures group by class, filter terms, edit amounts, and prefill new fees.");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}

