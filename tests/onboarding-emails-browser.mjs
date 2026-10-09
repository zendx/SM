import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { digest } from "../server/security.js";

const db = await openTestDatabase(),
  app = await createApp(db);
const owner = await insert(db, "users", {
  school_id: null,
  name: "Owner",
  email: "owner@sequence.test",
  role: "PLATFORM_OWNER",
  password_hash: "unused",
});
await insert(db, "platform_operators", { user_id: owner.id });
const session = "onboarding-browser-session";
await insert(db, "sessions", {
  user_id: owner.id,
  token_hash: digest(session),
  csrf: session,
  mfa_verified: true,
  expires_at: new Date(Date.now() + 300000),
});
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_URL = origin;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    { name: "smpis_session", value: session, url: origin },
  ]);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/owner#email-templates");
  await page
    .getByRole("button", { name: "Email templates", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "New-user email sequence", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Edit Your SMPIS menu tour", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Minutes after registration", { exact: false })
    .fill("45");
  await modal
    .getByRole("checkbox", { name: "Enable this email for new registrations" })
    .uncheck();
  await modal
    .getByRole("button", { name: "Save onboarding email", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  assert.equal(
    (
      await one(
        db,
        "SELECT delay_minutes FROM onboarding_email_steps WHERE template_key='onboarding_tour'",
      )
    ).delay_minutes,
    45,
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Your SMPIS menu tour" })
    .getByText("Paused", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Preview Your SMPIS menu tour", exact: true })
    .click();
  const preview = page.getByRole("dialog");
  await page
    .frameLocator('iframe[title="Onboarding HTML email preview"]')
    .getByRole("heading", { name: "Find your way around SMPIS" })
    .waitFor();
  await preview.screenshot({
    path: "test-results/onboarding-tour-preview.png",
  });
  await preview
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add scheduled email", exact: true })
    .click();
  await modal
    .getByLabel("Email name", { exact: false })
    .fill("Day two guidance");
  await modal
    .getByLabel("Email subject", { exact: false })
    .fill("A little help for {{school_name}}");
  await modal
    .getByLabel("Email message", { exact: false })
    .fill(
      "Hello {{name}},\n\nA helpful next step for your school. Open {{link}}",
    );
  await modal
    .getByLabel("Minutes after registration", { exact: false })
    .fill("1440");
  await modal
    .getByRole("button", { name: "Save onboarding email", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText("Day two guidance", { exact: true }).waitFor();
  assert.equal(
    (await one(db, "SELECT count(*)::int AS n FROM onboarding_email_steps")).n,
    3,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chrome owner onboarding editor, delay, pause, HTML preview and additional step passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
