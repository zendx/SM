import { testMailbox } from "./mailbox.js";
const verifyEmail = testMailbox();
import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { settleSubscriptionPayment } from "../server/saas-service.js";
import { hashPassword } from "../server/security.js";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const password = "Browser-referral-2026!";
try {
  const owner = await insert(db, "users", {
    school_id: null,
    name: "Owner",
    email: "owner@browser.test",
    password_hash: hashPassword(password),
    role: "PLATFORM_OWNER",
  });
  await insert(db, "platform_operators", { user_id: owner.id });
  await db.query("UPDATE saas_settings SET referral_percent=10 WHERE id=1");
  await page.goto(origin + "/marketers");
  await page.getByRole("button", { name: "Join the referral program" }).click();
  await page.getByLabel(/^Your full name/).fill("Browser Marketer");
  await page.getByLabel(/^Email address/).fill("marketer@browser.test");
  await page.getByLabel(/^Password/).fill(password);
  await page.getByLabel(/^Confirm password/).fill(password);
  await page.getByLabel("I have read and accept the privacy policy").check();
  await page
    .getByRole("button", { name: "Create marketer account", exact: true })
    .click();
  await page
    .getByText(
      "Check your email to verify your account, then sign in to the marketer portal.",
    )
    .waitFor();
  await verifyEmail("marketer@browser.test", origin + "/api/v1");
  await page.getByLabel(/^Email address/).fill("marketer@browser.test");
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your referral link and code" })
    .waitFor();
  const link = await page.getByLabel("Referral link").inputValue();
  assert.ok(link.includes("/signup?ref="));
  await page.getByLabel(/^Full name/).fill("Marketer Updated");
  await page.getByLabel(/^Bank name/).fill("Example Bank");
  await page.getByLabel(/^Account number/).fill("0123456789");
  await page.getByLabel(/^Account name/).fill("Marketer Updated");
  await page
    .getByRole("button", { name: "Save profile and bank account" })
    .click();
  await page.getByText("Profile and bank account updated.").waitFor();
  await fs.mkdir("test-results/branding-referrals", { recursive: true });
  await page.screenshot({
    path: "test-results/branding-referrals/marketer-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/branding-referrals/marketer-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Marketer portal overflows mobile viewport",
  );
  await page.goto(link);
  await page.getByLabel("Referral code (optional)").waitFor();
  assert.equal(
    await page.getByLabel("Referral code (optional)").inputValue(),
    new URL(link).searchParams.get("ref"),
  );
  await page.goto(origin + "/marketers");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const marketer = await one(
    db,
    "SELECT * FROM users WHERE email='marketer@browser.test'",
  );
  const school = await insert(db, "schools", {
    name: "Browser School",
    short_code: "BROWSER",
    portal_slug: "browser-school",
  });
  const admin = await insert(db, "users", {
    school_id: school.id,
    name: "School Admin",
    email: "admin@browser.test",
    password_hash: hashPassword(password),
    role: "SUPER_ADMIN",
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
    name: "Term 1",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    is_current: true,
  });
  await insert(db, "school_referrals", {
    school_id: school.id,
    marketer_id: marketer.id,
  });
  const payment = await insert(db, "subscription_payments", {
    school_id: school.id,
    reference: "BROWSER-REFERRAL",
    billing_cycle: "MONTHLY",
    amount_cents: 10000,
    method: "BANK",
    charge_amount_cents: 15000000,
    charge_currency: "NGN",
    initiated_by: admin.id,
  });
  await settleSubscriptionPayment(db, payment.id, owner.id);
  await page.goto(origin + "/owner");
  await page.getByLabel(/^Email address/).fill(owner.email);
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByRole("button", { name: "Sign in to owner dashboard" })
    .click();
  await page
    .getByRole("button", { name: "Marketer referrals", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Marketer referral program" })
    .waitFor();
  await page.getByLabel("Commission percentage").fill("15");
  await page.getByRole("button", { name: "Save referral settings" }).click();
  await page.waitForResponse(
    (r) =>
      r.url().endsWith("/saas/owner/referrals") &&
      r.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await page
    .getByLabel(/^Bank transfer reference/)
    .fill("BROWSER-TRANSFER-001");
  await page.getByRole("button", { name: "Confirm paid", exact: true }).click();
  await page
    .getByRole("cell", { name: "BROWSER-TRANSFER-001", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/branding-referrals/owner-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/branding-referrals/owner-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Owner referrals overflows mobile viewport",
  );
  await page.context().clearCookies();
  await page.request.post(origin + "/api/v1/auth/login", {
    data: { email: admin.email, password },
  });
  await page.goto(origin + "/browser-school/#administration");
  await page
    .getByLabel("Upload school logo")
    .setInputFiles({
      name: "school.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByText("School logo updated.", { exact: true }).waitFor();
  assert.ok(
    (
      await page.locator(".sidebar .school-logo").getAttribute("src")
    ).startsWith("data:image/png;base64,"),
  );
  await page.getByRole("button", { name: "Remove logo", exact: true }).click();
  await page.getByText("School logo removed.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: marketer signup, verification, login, bank profile, referral autofill, mobile layouts, owner commission settings, payout recording and school logo upload/removal.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
