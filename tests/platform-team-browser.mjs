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
    ["Customer support", "Account security"],
  );
  await page.getByRole("button", { name: "Review issue" }).click();
  await page.getByLabel("Issue status").selectOption("RESOLVED");
  await page
    .getByLabel("Response / resolution")
    .fill("Our Sales Department can help with your billing plan.");
  await page.getByRole("button", { name: "Update support issue" }).click();
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
