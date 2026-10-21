import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import * as OTPAuth from "otpauth";
import assert from "node:assert/strict";
import path from "node:path";

process.env.SECURITY_ENCRYPTION_KEY = "28".repeat(32);
for (const key of [
  "RECAPTCHA_SITE_KEY",
  "RECAPTCHA_SECRET_KEY",
  "SMTP_URL",
  "MAIL_FROM",
])
  delete process.env[key];
const db = await openTestDatabase();
const app = await createApp(db);
serveFrontend(app, path.resolve("dist"));
const owner = await insert(db, "users", {
  school_id: null,
  name: "Browser Owner",
  email: "owner@browser-security.test",
  password_hash: hashPassword("Browser-password-2026!"),
  role: "PLATFORM_OWNER",
  email_verified: true,
});
await insert(db, "platform_operators", { user_id: owner.id });
const school = await insert(db, "schools", {
  name: "Browser Security School",
  short_code: "BSS",
  portal_slug: "browser-security",
});
await insert(db, "users", {
  school_id: school.id,
  name: "Browser Admin",
  email: "admin@browser-security.test",
  password_hash: hashPassword("Browser-password-2026!"),
  role: "SUPER_ADMIN",
  email_verified: true,
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  for (const [route, email, button, artifact] of [
    [
      "/owner",
      "owner@browser-security.test",
      "Sign in to owner dashboard",
      "owner",
    ],
    ["/browser-security/", "admin@browser-security.test", "Sign in", "school"],
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + route);
    await page.screenshot({
      path: `test-results/hardening-${artifact}-login.png`,
    });
    const consent = page.getByRole("button", {
      name: "Accept required cookies",
      exact: true,
    });
    if (await consent.count()) await consent.click();
    await page.getByLabel(/Email address/).fill(email);
    await page.getByLabel(/^Password/).fill("Browser-password-2026!");
    await page
      .getByRole("button", {
        name: button === "Sign in" ? "Sign in to your workspace" : button,
        exact: true,
      })
      .click();
    await page
      .getByRole("heading", { name: "Secure your account", exact: true })
      .waitFor();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/auth/mfa/setup") && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Set up authenticator", exact: true })
      .click();
    const { data } = await (await response).json();
    const code = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(data.secret),
    }).generate();
    await page.getByLabel(/Authenticator code/).fill(code);
    await page.screenshot({
      path: `test-results/hardening-${artifact}-enrollment.png`,
    });
    await page
      .getByRole("button", { name: "Enable and continue", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Secure your account", exact: true })
      .waitFor({ state: "hidden" });
    await page.locator("nav").first().waitFor();
    assert.equal(
      await page.getByText("We couldn’t load SMPIS", { exact: true }).count(),
      0,
    );
    await page.screenshot({
      path: `test-results/hardening-${artifact}-unlocked.png`,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Owner and school administrator enrollment/unlock browser flows passed without page errors.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
