import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { testMailbox } from "./mailbox.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";

const verifyEmail = testMailbox();
const db = await openTestDatabase();
const app = await createApp(db);
serveFrontend(app, path.resolve("dist"));
const password = "Support-browser-2026!";
const owner = await insert(db, "users", {
  school_id: null,
  name: "Owner",
  email: "owner@browser.test",
  role: "PLATFORM_OWNER",
  password_hash: hashPassword(password),
});
await insert(db, "platform_operators", { user_id: owner.id });
const school = await insert(db, "schools", {
  name: "Support Academy",
  short_code: "SUPPORT",
  portal_slug: "support-academy",
});
await insert(db, "users", {
  school_id: school.id,
  name: "School Admin",
  email: "admin@browser.test",
  phone_number: "+2348012345678",
  role: "SUPER_ADMIN",
  password_hash: hashPassword(password),
});
await insert(db, "academic_years", {
  school_id: school.id,
  name: "2026",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function signIn(email, route = "/owner") {
    await page.context().clearCookies();
    await page.goto(origin + route);
    await page.getByLabel("Email address").fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page
      .getByRole("button", {
        name:
          route === "/owner"
            ? "Sign in to owner dashboard"
            : "Sign in to your workspace",
        exact: true,
      })
      .click();
  }
  await signIn("admin@browser.test", "/support-academy/#support");
  await page.getByRole("heading", { name: "Get help from SMPIS" }).waitFor();
  await page.getByRole("button", { name: "Report an issue" }).click();
  await page.getByLabel("Department").selectOption("SALES");
  await page.getByLabel("Issue subject").fill("Help choosing our plan");
  await page
    .getByLabel("Describe the problem")
    .fill("Please explain the available billing plans for our school.");
  await page.getByRole("button", { name: "Submit support request" }).click();
  await page
    .getByRole("cell", { name: "Help choosing our plan", exact: true })
    .waitFor();
  assert.equal(
    (await one(db, "SELECT department FROM saas_support_tickets LIMIT 1"))
      .department,
    "SALES",
  );
  await signIn("owner@browser.test");
  await page
    .getByRole("button", { name: "Payment settings", exact: true })
    .click();
  await page.getByLabel("Monthly Pro price (USD)").fill("55");
  await page.getByLabel("Yearly Pro price (USD)").fill("550");
  await page
    .getByRole("button", { name: "Save bank & subscription settings" })
    .click();
  await page.getByText("Payment settings updated.", { exact: true }).waitFor();
  assert.equal(
    (await one(db, "SELECT monthly_price_cents FROM saas_settings WHERE id=1"))
      .monthly_price_cents,
    5500,
  );
  const pricingPage = await browser.newPage();
  pricingPage.on("pageerror", (error) => errors.push(error.message));
  await pricingPage.goto(origin);
  await pricingPage.locator(".plan-price").filter({ hasText: "$55" }).waitFor();
  await pricingPage.getByRole("button", { name: /Yearly.*Save/ }).click();
  await pricingPage
    .locator(".plan-price")
    .filter({ hasText: "$550" })
    .waitFor();
  await pricingPage.close();
  await page
    .getByRole("button", { name: "Email templates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit Support reply to tenant", exact: true })
    .click();
  await page.getByLabel("Email subject").fill("Support update: {{title}}");
  await page
    .getByLabel("Email message template")
    .fill("Hello from SMPIS\n{{body}}\n{{link}}");
  await page
    .getByRole("button", { name: "Save email template", exact: true })
    .click();
  await page.getByText("Email template saved.", { exact: true }).waitFor();
  await page
    .locator('nav[aria-label="Owner navigation"]')
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page.getByText(/New sales support ticket/).waitFor();
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await page.getByRole("cell", { name: "Read", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Tenant communications", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "+2348012345678", exact: true })
    .waitFor();
  const exported = await page.request.get(
    origin + "/api/v1/saas/owner/contacts?format=csv",
  );
  assert.ok((await exported.text()).includes("admin@browser.test"));
  await page.getByRole("checkbox", { name: "Select Support Academy" }).check();
  await page.getByLabel("Notification subject").fill("Owner announcement");
  await page
    .getByLabel("Notification message")
    .fill("An update for your school from SMPIS.");
  await page
    .getByRole("button", { name: "Send notification", exact: true })
    .click();
  await page
    .getByText("Notification queued for 1 school administrator(s).", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Console team", exact: true }).click();
  await page
    .getByRole("button", { name: "Create team account", exact: true })
    .click();
  await page.getByLabel("Full name").fill("Sales Agent");
  await page.getByLabel("Email address").fill("sales@browser.test");
  await page.getByLabel("Initial password").fill(password);
  await page.getByLabel("Assigned access").selectOption("SALES");
  await page
    .getByRole("button", { name: "Create account and send verification" })
    .click();
  await page.getByRole("cell", { name: "Sales Agent", exact: true }).waitFor();
  await verifyEmail("sales@browser.test", origin + "/api/v1");
  await signIn("sales@browser.test");
  await page.getByRole("heading", { name: "Customer support queue" }).waitFor();
  assert.deepEqual(
    await page
      .locator('nav[aria-label="Owner navigation"] button')
      .allTextContents(),
    ["Customer support", "Notifications", "Account security"],
  );
  await page.getByRole("button", { name: "Reply / manage ticket" }).click();
  await page.getByLabel("Issue status").selectOption("RESOLVED");
  await page
    .getByLabel("Reply to customer")
    .fill("Our Sales Department can help with your billing plan.");
  await page
    .getByRole("button", { name: "Send reply / update status" })
    .click();
  await page.getByRole("cell", { name: "Resolved", exact: true }).waitFor();
  await signIn("admin@browser.test", "/support-academy/#subscription");
  await page
    .getByRole("button", { name: "Pause subscription", exact: true })
    .click();
  await page.getByLabel("Reason").fill("School holiday pause");
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Confirm account change" }).click();
  await page
    .getByRole("button", { name: "Resume subscription", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Support", exact: true }).click();
  await page
    .getByText("Our Sales Department can help with your billing plan.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByText("Owner announcement", { exact: true }).waitFor();
  await page.getByText(/SMPIS replied to support ticket/).waitFor();
  await page
    .getByRole("button", { name: "Mark all as read", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("td")].every(
      (cell) => cell.textContent !== "Unread",
    ),
  );
  await page.getByRole("button", { name: "Subscription", exact: true }).click();
  await page
    .getByRole("button", { name: "Request account deletion", exact: true })
    .click();
  await page.getByLabel("Reason").fill("Closing our account");
  await page.getByLabel("Confirm your password").fill(password);
  await page
    .getByRole("button", { name: "Confirm deletion request", exact: true })
    .click();
  await page.getByText(/Administrator Support access ends on/).waitFor();
  await signIn("owner@browser.test");
  await page
    .getByRole("button", { name: "Schools & subscriptions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reactivate account", exact: true })
    .click();
  await page
    .getByLabel("Reason")
    .fill("School contacted support and requested reactivation");
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await page.getByText("School access updated.", { exact: true }).waitFor();
  assert.equal(
    (
      await one(
        db,
        "SELECT deletion_requested_at FROM school_subscriptions WHERE school_id=$1",
        [school.id],
      )
    ).deletion_requested_at,
    null,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chrome support, delegated navigation, pause, deletion and owner reactivation checks passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
