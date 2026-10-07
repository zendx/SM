import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { chromium } from "@playwright/test";
import { serveFrontend } from "../server/frontend.js";

const app = express();
serveFrontend(app, path.resolve("dist"));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addCookies([{ name: "smpis_session", value: "existing-owner-session", url: origin }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    requests.push(request.url());
    const confirm = request.url().endsWith("/email-verification/confirm");
    if (confirm) assert.equal(request.postDataJSON().token, "a".repeat(64));
    else if (request.url().endsWith("/email-verification/resend"))
      assert.equal(request.postDataJSON().email, "school@example.com");
    await route.fulfill({ json: { data: { message: confirm ? "Email verified. You can now sign in." : "If this account needs verification, a link has been sent." } } });
  });
  await page.goto(`${origin}/login?verify=${"a".repeat(64)}`);
  await page.getByRole("heading", { name: "Verify your email" }).waitFor();
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await page.getByText("Email verified. You can now sign in.").waitFor();
  assert.equal(new URL(page.url()).search, "");
  await page.getByRole("button", { name: "Resend verification email", exact: true }).click();
  await page.getByLabel("Email address").fill("school@example.com");
  await page.getByRole("button", { name: "Resend verification email", exact: true }).click();
  await page.getByText("If this account needs verification, a link has been sent.").waitFor();
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
  console.log("Chrome verification and resend flows passed with an existing session cookie.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
