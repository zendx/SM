import { openTestDatabase } from "./database.js";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { insert } from "../server/db.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { digest } from "../server/security.js";
process.env.REQUIRE_MFA = "false";
const db = await openTestDatabase();
const dataDir = path.resolve("test-results", "site-browser-" + randomUUID());
const app = await createApp(db, { dataDir, backendControl: true });
serveFrontend(app, path.resolve("public"));
const school = await insert(db, "schools", {
  name: "Legal school",
  short_code: "LEGAL",
});
const user = await insert(db, "users", {
  school_id: school.id,
  name: "Admin",
  email: "admin@legal.test",
  password_hash: "unused",
  role: "SUPER_ADMIN",
});
const session = randomUUID();
await insert(db, "sessions", {
  user_id: user.id,
  token_hash: digest(session),
  csrf: session,
  mfa_verified: true,
  expires_at: new Date(Date.now() + 120000),
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/privacy");
  await page
    .getByRole("heading", { name: "Privacy policy", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Accept required cookies", exact: true })
    .click();
  assert.ok(
    (await context.cookies()).some(
      (c) =>
        c.name === "smpis_cookie_preferences" &&
        c.value === "essential-v1" &&
        c.sameSite === "Lax",
    ),
  );
  await page.reload();
  assert.equal(
    await page
      .getByRole("button", { name: "Accept required cookies", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dismiss without saving", exact: true })
    .click();
  assert.ok(
    !(await context.cookies()).some(
      (c) => c.name === "smpis_cookie_preferences",
    ),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Accept required cookies", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Accept required cookies", exact: true })
    .click();
  for (const [route, title] of [
    ["/terms", "Terms and conditions"],
    ["/cookies", "Cookie policy"],
  ]) {
    await page.goto(origin + route);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  }
  await context.addCookies([
    {
      name: "smpis_session",
      value: session,
      url: origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto(origin + "/#administration");
  await page
    .getByRole("button", { name: "Site Settings", exact: true })
    .click();
  await page
    .getByLabel("Legal organization name")
    .fill("Configured School Operator");
  await page.getByLabel("Privacy contact email").fill("privacy@legal.test");
  const panel = page.locator("section.panel").filter({
    has: page.getByRole("heading", {
      name: "Terms and privacy contact",
      exact: true,
    }),
  });
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText("Legal contact details published.", { exact: true })
    .waitFor();
  await page.goto(origin + "/privacy");
  await page.getByText("Configured School Operator", { exact: true }).waitFor();
  await page
    .getByRole("link", { name: "privacy@legal.test", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Site browser checks passed: public policies, cookie acceptance/dismissal/persistence, legal contact settings, mobile layout.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
