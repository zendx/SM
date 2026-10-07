import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";

const db = await openTestDatabase(),
  originalFetch = globalThis.fetch;
const app = await createApp(db);
process.env.STOPREG_API_TOKEN = "fake-browser-token";
let disposable = true;
globalThis.fetch = (url, options) =>
  String(url).startsWith("https://api.stopreg.com/")
    ? Promise.resolve(
        new Response(
          JSON.stringify({
            status: 200,
            data: {
              classification: { is_disposable: disposable },
              list_match: { blocklisted: false },
              policy: { action: disposable ? "allow" : "block" },
            },
          }),
        ),
      )
    : originalFetch(url, options);
const owner = await insert(db, "users", {
  school_id: null,
  name: "Owner",
  email: "owner@browser.test",
  role: "PLATFORM_OWNER",
  password_hash: hashPassword("StopReg-browser-2026!"),
});
await insert(db, "platform_operators", { user_id: owner.id });
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/signup`);
  await page.getByLabel("School name", { exact: false }).fill("Test Academy");
  await page
    .getByLabel("School portal name", { exact: false })
    .fill("stopreg-browser");
  await page
    .getByLabel("Administrator name", { exact: false })
    .fill("School Admin");
  await page
    .getByLabel("Administrator email", { exact: false })
    .fill("admin@temporary.test");
  await page
    .getByLabel("Administrator phone number", { exact: false })
    .fill("+2348012345678");
  await page.getByLabel("Administrator password").fill("StopReg-browser-2026!");
  await page.getByRole("button", { name: "Create school portal" }).click();
  await page
    .getByText(
      "You can't register with a disposable or temporary email address. Please use a permanent personal or school email address.",
      { exact: true },
    )
    .waitFor();
  disposable = false;
  await page.getByRole("button", { name: "Create school portal" }).click();
  await page
    .getByText(/This email address was flagged by our email screening service/)
    .waitFor();
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM schools")).n, 0);
  console.log(
    "Chrome signup displays clean disposable and flagged email errors without creating a school.",
  );
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
