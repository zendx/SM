import assert from "node:assert/strict";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { newsletterUnsubscribeLink } from "../server/contact-consent.js";

const db = await openTestDatabase();
const app = await createApp(db);
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const owner = await insert(db, "users", {
  school_id: null,
  name: "Owner",
  email: "owner@consent-browser.test",
  role: "PLATFORM_OWNER",
  password_hash: "unused",
  marketing_email_consent: true,
});
await insert(db, "platform_operators", { user_id: owner.id });
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
process.env.APP_URL = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL + "/signup");
  const privacy = page.getByRole("checkbox", {
    name: /I confirm that I have read the privacy policy/,
  });
  await privacy.waitFor();
  assert.equal(await privacy.isChecked(), false);
  assert.equal(await privacy.getAttribute("required"), "");
  assert.equal(
    await page
      .getByRole("checkbox", { name: /Email me promotional/ })
      .isChecked(),
    false,
  );
  assert.equal(
    await page
      .getByRole("checkbox", { name: /Use my phone number/ })
      .isChecked(),
    false,
  );
  const privacyLink = page.locator('label.check-field a[href="/privacy"]');
  assert.equal(await privacyLink.getAttribute("target"), "_blank");
  await privacy.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/signup-consent-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.goto(process.env.APP_URL + "/privacy");
  await page
    .getByRole("heading", {
      name: "Email, phone numbers and promotional communications",
    })
    .waitFor();
  await page.getByText(/Last updated: 2026-10-09/).waitFor();
  await page.goto(newsletterUnsubscribeLink(owner));
  await page
    .getByRole("heading", { name: "Promotional email preferences" })
    .waitFor();
  assert.equal(
    (
      await one(db, "SELECT marketing_email_consent FROM users WHERE id=$1", [
        owner.id,
      ])
    ).marketing_email_consent,
    true,
  );
  await page
    .getByRole("button", {
      name: "Unsubscribe from promotional emails",
      exact: true,
    })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "You are unsubscribed" })
    .waitFor();
  assert.equal(
    (
      await one(db, "SELECT marketing_email_consent FROM users WHERE id=$1", [
        owner.id,
      ])
    ).marketing_email_consent,
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chrome mobile consent, updated privacy policy and anonymous unsubscribe passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
