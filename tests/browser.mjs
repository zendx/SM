import { openTestDatabase } from "./database.js";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import express from "express";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../server/app.js";
import { localClock } from "../server/security.js";
import * as OTPAuth from "otpauth";
process.env.REQUIRE_MFA = "true";
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const db = await openTestDatabase(),
  app = await createApp(db, { dataDir: "test-results/uploads" });
app.use(express.static("dist"));
app.get("/{*path}", (req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const today = localClock("Africa/Lagos").date,
  year = Number(today.slice(0, 4));
const field = (name) => page.getByLabel(name, { exact: false });
async function save(label) {
  await page.getByRole("button", { name: label, exact: true }).click();
}
async function navigate(label) {
  await page
    .locator("nav")
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function closed() {
  await page.locator("dialog").waitFor({ state: "hidden" });
}
try {
  const setup = await page.request.post(origin + "/api/v1/auth/setup", {
    data: {
      school_name: "Greenfield Academy", phone_number: "+2348012345678",
      short_code: "GFA",
      currency_code: "NGN",
      timezone: "Africa/Lagos",
      name: "School Administrator",
      email: "admin@greenfield.test",
      password: "Browser-test-2026!",
      year_name: String(year),
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    },
  });
  assert.equal(setup.status(), 201, await setup.text());
  await page.goto(origin + "/login");
  await page
    .getByRole("button", { name: "Accept required cookies", exact: true })
    .click();
  await field("Email address").fill("admin@greenfield.test");
  await page.getByLabel(/^Password \*$/).fill("Browser-test-2026!");
  await save("Sign in to your workspace");
  await page
    .getByRole("heading", { name: "Finish administrator security setup" })
    .waitFor();
  await page
    .getByText("Complete this step to unlock the rest of SMPIS.")
    .waitFor();
  assert.equal(await page.locator("nav button").count(), 1);
  const notificationRequests = [];
  const recordNotificationRequest = (request) => {
    if (request.url().includes("/api/v1/notifications"))
      notificationRequests.push(request.url());
  };
  page.on("request", recordNotificationRequest);
  await page.evaluate(() => {
    location.hash = "notifications";
  });
  await page.waitForFunction(() => location.hash === "#administration");
  assert.deepEqual(notificationRequests, []);
  page.off("request", recordNotificationRequest);
  await save("Set up authenticator");
  await page
    .getByRole("img", { name: "Authenticator setup QR code" })
    .waitFor();
  assert.ok(await page.locator(".secret-key").isVisible());
  const secret = await page.locator(".secret-key").textContent();
  const otp = new OTPAuth.TOTP({
    issuer: "SMPIS",
    label: "admin@greenfield.test",
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  await field("Verification code").fill(otp.generate());
  await save("Enable verification");
  await page.locator("nav").getByRole("button", { name: "Overview" }).waitFor();
  await navigate("Overview");
  await page.getByRole("heading", { name: "Welcome, School" }).waitFor();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Academic records" }).click();
  await page
    .getByRole("heading", { name: "Historical class records" })
    .waitFor();
  assert.equal(new URL(page.url()).hash, "#academics/records");
  await page.reload();
  await page
    .getByRole("heading", { name: "Historical class records" })
    .waitFor();
  await navigate("Administration");
  await save("Classes");
  await save("New class");
  await field("Class name").fill("Grade 5A");
  await field("Academic year").last().selectOption({ index: 1 });
  await save("Save");
  await closed();
  await navigate("Admissions");
  await save("New application");
  await field("First name").fill("Amara");
  await field("Last name").fill("Obi");
  await field("Gender").selectOption("FEMALE");
  await field("Date of birth").fill("2016-04-12");
  await field("Applying for class").selectOption({ index: 1 });
  await field("Parent / guardian name").fill("Ada Obi");
  await field("Guardian phone").fill("08000000000");
  await field("Guardian email").fill("ada@example.test");
  await save("Create application");
  await closed();
  for (const stage of [
    "Reviewed",
    "Assessment Scheduled",
    "Decision Pending",
    "Offered",
    "Fees Pending",
  ]) {
    await save(stage);
    await save(`Move to ${stage}`);
    await closed();
  }
  await navigate("Finance");
  await save("Fee Structures");
  await save("Set fee");
  await field("Class").last().selectOption({ index: 1 });
  await field("Fee category").selectOption("TUITION");
  await field("Amount (NGN)").fill("120000");
  await save("Save");
  await closed();
  await save("Generate invoice");
  await field("Student").last().selectOption({ index: 1 });
  await page
    .locator("dialog")
    .getByRole("button", { name: "Generate invoice", exact: true })
    .click();
  await closed();
  await save("Record payment");
  await field("Invoice").last().selectOption({ index: 1 });
  await field("Amount (NGN)").fill("120000");
  await field("Payment method").selectOption("BANK_TRANSFER");
  await field("Payment reference").fill("BROWSER-001");
  await save("Save payment & issue receipt");
  await closed();
  await save("Invoices");
  await page.locator("tbody").getByText("Paid", { exact: true }).waitFor();
  await navigate("Admissions");
  await save("Enroll");
  await save("Enroll student");
  await closed();
  await navigate("Students");
  await save("View profile →");
  await page
    .getByRole("heading", { name: "Student profile", exact: true })
    .waitFor();
  await page.getByLabel("Upload supporting document").setInputFiles({
    name: "birth-certificate.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n test document"),
  });
  await page.getByRole("link", { name: "birth-certificate.pdf" }).waitFor();
  await save("Close dialog");
  await navigate("Attendance");
  await page.getByText("Amara Obi", { exact: true }).waitFor();
  await save("Unlock date");
  await field("Attendance for Amara Obi").selectOption("LATE");
  await save("Save attendance");
  await page
    .getByRole("status")
    .filter({ hasText: "Attendance saved" })
    .waitFor();
  await navigate("Staff & attendance");
  await save("Add staff member");
  await field("First name").fill("Mariam");
  await field("Last name").fill("Bello");
  await field("Department").fill("Primary");
  await field("Position").fill("Teacher");
  await save("Save");
  await closed();
  await save("In");
  await save("Attendance log");
  await page.getByText("Mariam Bello", { exact: true }).waitFor();
  await navigate("Reports");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .first()
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "smpis-students.csv");
  await navigate("Overview");
  await page.getByRole("heading", { name: "Welcome, School" }).waitFor();
  await page.screenshot({
    path: "test-results/dashboard-populated.png",
    fullPage: true,
  });
  for (const label of [
    "Students",
    "Admissions",
    "Attendance",
    "Finance",
    "Staff & attendance",
    "Reports",
    "Administration",
  ]) {
    await navigate(label);
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator(".form-error").count(),
      0,
      `Unexpected error on ${label}`,
    );
  }
  await save("Integrations");
  await page
    .getByRole("heading", { name: "SMTP email", exact: true })
    .waitFor();
  const paystackPanel = page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", { name: "Paystack", exact: true }),
    });
  await paystackPanel.getByLabel("Enable this integration").check();
  await paystackPanel.getByLabel("Public key").fill("pk_test_browser");
  await paystackPanel
    .getByLabel("Secret key", { exact: true })
    .fill("sk_test_browser_private");
  const integrationSaved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/integrations/paystack") &&
      r.request().method() === "PATCH",
  );
  await paystackPanel
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal((await integrationSaved).status(), 200);
  await paystackPanel
    .getByText("Saved securely. Leave blank to keep the current value.")
    .waitFor();
  assert.equal(
    await paystackPanel.getByLabel("Secret key", { exact: true }).inputValue(),
    "",
  );
  await page.screenshot({
    path: "test-results/administration-integrations.png",
    fullPage: true,
  });
  await paystackPanel
    .getByRole("button", { name: "Remove credentials and disable" })
    .click();
  await paystackPanel.getByText("No credential saved.").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await navigate("Overview");
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile page should not overflow horizontally",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await save("Sign out");
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser workflow passed: setup, login, class, admissions, fees, invoice, payment, enrollment, profile/upload, attendance, staff check-in, export, all navigation, integration credential save/removal, mobile, logout.",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/browser-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
