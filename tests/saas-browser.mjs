import { openTestDatabase } from "./database.js";
import { chromium } from "@playwright/test";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { one } from "../server/db.js";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
process.env.REQUIRE_MFA = "false";
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const db = await openTestDatabase(),
  app = await createApp(db);
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => errors.push(e.message));
const password = "Browser-SaaS-test-2026!";
await mkdir("test-results", { recursive: true });
try {
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "Less paperwork. More possibility." })
    .waitFor();
  await page.getByRole("button", { name: "Accept required cookies" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".sales-page").classList.contains("motion-ready"),
  );
  assert.ok((await page.locator(".reveal-item:not(.is-visible)").count()) > 0);
  for (const item of await page.locator(".reveal-item").all())
    await item.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".reveal-item:not(.is-visible)").length === 0,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      !document.querySelector(".sales-page").classList.contains("motion-ready"),
  );
  assert.equal(
    await page
      .locator(".hero-copy")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({
    path: "test-results/smpis-landing-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Yearly Save 15%" }).click();
  await page.getByText("$1,020", { exact: false }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            width: el.getBoundingClientRect().width,
            right: el.getBoundingClientRect().right,
          }))
          .slice(0, 12),
      ),
    ),
  );
  await page.screenshot({
    path: "test-results/smpis-landing-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/owner");
  console.log("Checking owner setup");
  assert.equal(
    await page.getByLabel("School name", { exact: false }).count(),
    0,
  );
  await page.getByLabel("Your full name", { exact: false }).fill("SMPIS Owner");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("owner@browser-saas.test");
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  assert.equal(
    Number((await one(db, "SELECT count(*) AS n FROM schools")).n),
    0,
  );
  await page.goto(origin + "/login");
  await page.waitForURL("**/owner");
  console.log("Checking owner payment settings");
  await page
    .getByRole("heading", { name: "Your business, at a glance." })
    .waitFor();
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await page
    .getByLabel("Your full name", { exact: false })
    .fill("Updated SMPIS Owner");
  await page.getByLabel("Current password", { exact: false }).fill(password);
  await page.getByRole("button", { name: "Save owner credentials" }).click();
  await page
    .getByText(
      "Owner credentials updated. Other signed-in sessions have been ended.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (
      await one(
        db,
        "SELECT name FROM users WHERE email='owner@browser-saas.test'",
      )
    ).name,
    "Updated SMPIS Owner",
  );

  await page
    .getByRole("button", { name: "Payment settings", exact: true })
    .click();
  const currencySelect = page.getByLabel("Landing page pricing currency", {
    exact: false,
  });
  assert.equal(
    await currencySelect.locator('option[value="USD"]').textContent(),
    "USD",
  );
  assert.equal(
    await currencySelect.locator('option[value="NGN"]').textContent(),
    "NGN",
  );
  await currencySelect.selectOption("NGN");
  await page
    .getByLabel("Public pricing exchange rate", { exact: false })
    .fill("1500");
  const spacing = await page
    .getByLabel("Bank name", { exact: false })
    .evaluate((el) => {
      const field = el.getBoundingClientRect(),
        panel = el.closest(".panel").getBoundingClientRect();
      return {
        left: field.left - panel.left,
        right: panel.right - field.right,
      };
    });
  assert.ok(spacing.left >= 16 && spacing.right >= 16, JSON.stringify(spacing));
  await page.getByLabel("Bank name", { exact: false }).fill("Sandbox Bank");
  await page.getByLabel("Account name", { exact: false }).fill("SMPIS");
  await page.getByLabel("Account number", { exact: false }).fill("1234567890");
  await page.getByLabel("Bank currency", { exact: false }).selectOption("NGN");
  await page.getByRole("spinbutton", { name: /^NGN per USD/ }).fill("1500");
  await page
    .getByRole("button", { name: "Save bank & subscription settings" })
    .click();
  await page.getByText("Payment settings updated.", { exact: true }).waitFor();
  const publicPage = await browser.newPage();
  await publicPage.goto(origin + "/#pricing");
  await publicPage
    .locator(".pro-card .plan-price")
    .getByText("NGN", { exact: false })
    .waitFor();
  assert.ok(
    (await publicPage.locator(".pro-card .plan-price").innerText()).includes(
      "150,000",
    ),
  );
  await publicPage.getByRole("button", { name: "Yearly Save 15%" }).click();
  assert.ok(
    (await publicPage.locator(".pro-card .plan-price").innerText()).includes(
      "1,530,000",
    ),
  );
  assert.ok(
    (
      await publicPage.locator(".pro-card .price-note").first().innerText()
    ).includes("270,000"),
  );
  await publicPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await publicPage.close();
  for (const provider of ["Stripe", "Paystack", "Flutterwave"]) {
    await page
      .getByRole("button", { name: `Configure ${provider}`, exact: true })
      .click();
    const dialog = page.locator("dialog");
    await dialog.getByLabel("Enable this provider", { exact: false }).check();
    await dialog
      .getByLabel("Secret key", { exact: true })
      .fill(
        provider === "Flutterwave" ? "FLWSECK-sandbox_TEST" : "sk_test_sandbox",
      );
    await dialog.getByLabel(/Webhook/).fill("webhook_sandbox_secret");
    if (provider !== "Stripe")
      await dialog
        .getByRole("spinbutton", { name: /^NGN per USD/ })
        .fill("1500");
    await dialog
      .getByRole("button", { name: "Save provider configuration" })
      .click();
    await dialog.waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(origin + "/signup");
  console.log("Checking self signup");
  await page
    .getByLabel("School name", { exact: false })
    .fill("Greenfield Academy");
  await page
    .getByLabel("School portal name", { exact: false })
    .fill("greenfield-academy");
  await page
    .getByLabel("Administrator name", { exact: false })
    .fill("Greenfield Administrator");
  await page
    .getByLabel("Administrator email", { exact: false })
    .fill("greenfield@browser-saas.test");
  await page
    .getByLabel("Administrator password", { exact: false })
    .fill(password);
  await page.getByRole("button", { name: "Create school portal" }).click();
  await page.waitForURL(/greenfield-academy\/#subscription/);
  await page
    .getByRole("heading", { name: "Keep your school connected" })
    .waitFor();
  await page.getByText("Free trial", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/smpis-school-billing.png",
    fullPage: true,
  });
  const school = await one(
    db,
    "SELECT id FROM schools WHERE portal_slug='greenfield-academy'",
  );
  await db.query(
    "UPDATE school_subscriptions SET period_end=now()-interval '1 second' WHERE school_id=$1",
    [school.id],
  );
  await page.reload();
  await page.getByText("School access is paused.", { exact: true }).waitFor();
  assert.equal(await page.locator("nav button").count(), 0);
  await page
    .getByLabel("Billing period", { exact: false })
    .selectOption("YEARLY");
  await page
    .getByLabel("Bank transfer reference", { exact: false })
    .fill("BANK-BROWSER-1");
  await page
    .getByRole("button", { name: "Submit transfer for approval" })
    .click();
  await page
    .getByText(
      "Transfer submitted. Pro starts after the SMPIS owner confirms receipt.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(origin + "/owner");
  await page
    .getByLabel("Email address", { exact: false })
    .fill("owner@browser-saas.test");
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByRole("button", { name: "Sign in to owner dashboard" })
    .click();
  await page
    .getByRole("button", { name: "Payments & revenue", exact: true })
    .click();
  await page.getByRole("button", { name: "Review transfer" }).click();
  const dialog = page.locator("dialog");
  await dialog.getByLabel("Decision", { exact: false }).selectOption("APPROVE");
  await dialog
    .getByLabel("Review note", { exact: false })
    .fill("Verified in isolated test bank statement.");
  await dialog.getByRole("button", { name: "Save payment decision" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Schools & subscriptions", exact: true })
    .click();
  await page.getByText("Pro · yearly", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/smpis-owner-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await page
    .locator("dialog")
    .getByLabel("Reason", { exact: false })
    .fill("Browser verification");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Suspend subscription" })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .locator("dialog")
    .getByLabel("Reason", { exact: false })
    .fill("Resolved");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Restore subscription" })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Business overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Signups", exact: true }).click();
  assert.equal(await page.locator(".owner-growth-chart button").count(), 6);
  await page.screenshot({
    path: "test-results/smpis-owner-overview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Customer accounts", exact: true })
    .click();
  await page.getByLabel("Search customer accounts").fill("Greenfield");
  await page.getByRole("button", { name: "Manage account" }).click();
  await page
    .locator("dialog")
    .getByLabel("Reason for recovery action")
    .fill("Identity verified in browser regression");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Apply recovery action" })
    .click();
  await page
    .getByRole("heading", { name: "One-time account recovery link" })
    .waitFor();
  assert.ok(
    (await page.getByLabel("Password reset link").inputValue()).includes(
      "?reset=",
    ),
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const user = await one(
    db,
    "SELECT id,school_id FROM users WHERE email='greenfield@browser-saas.test'",
  );
  await db.query(
    "INSERT INTO saas_support_tickets(school_id,user_id,subject,description) VALUES($1,$2,'Browser support request','Please help resolve this account access problem.')",
    [user.school_id, user.id],
  );
  await page
    .getByRole("button", { name: "Customer support", exact: true })
    .click();
  await page.getByRole("button", { name: "Review issue" }).click();
  await page
    .locator("dialog")
    .getByLabel("Issue status")
    .selectOption("RESOLVED");
  await page
    .locator("dialog")
    .getByLabel("Response / resolution")
    .fill("Account holder verified. Recovery instructions supplied.");
  await page
    .locator("dialog")
    .getByRole("button", { name: "Update support issue" })
    .click();
  await page.locator("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await one(db, "SELECT status FROM saas_support_tickets LIMIT 1")).status,
    "RESOLVED",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open owner navigation" }).click();
  await page
    .getByRole("button", { name: "Business overview", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your business, at a glance." })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".owner-sidebar").getBoundingClientRect().right <=
      0,
  );
  await page.screenshot({
    path: "test-results/smpis-owner-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/greenfield-academy/");
  await page
    .getByRole("button", { name: "Switch account", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Welcome back", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "SaaS browser passed: desktop/mobile landing, yearly pricing, signup, owner provider settings, trial expiry, bank renewal, suspend/restore, account recovery, support resolution, owner mobile navigation and reduced-motion.",
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/smpis-browser-failure.png",
    fullPage: true,
  });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
