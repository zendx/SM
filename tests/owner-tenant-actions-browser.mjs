import { accountFixture } from "./account-fixture.js";
import { serveFrontend } from "../server/frontend.js";
import { chromium, expect } from "@playwright/test";
import { one } from "../server/db.js";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const f = await accountFixture();
serveFrontend(f.app, path.resolve("dist"));
const server = f.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.request.post(origin + "/api/v1/auth/login", {
    data: { email: f.users.owner.email, password: f.password },
  });
  assert.equal(response.status(), 200);
  await page.goto(origin + "/owner#tenants");
  const panel = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Tenant accounts & subscriptions",
      exact: true,
    }),
  });
  await expect(panel).toBeVisible();
  const cookies = page.getByRole("button", {
    name: "Accept required cookies",
    exact: true,
  });
  if (await cookies.isVisible()) await cookies.click();
  const row = panel.getByRole("row").filter({ hasText: "Greenfield Academy" });
  await row
    .getByRole("button", { name: "Suspend account", exact: true })
    .click();
  await page.getByLabel(/^Reason/).fill("Owner review");
  await page
    .getByRole("button", { name: "Suspend subscription", exact: true })
    .click();
  await expect(row).toContainText(/suspended/i);
  await row
    .getByRole("button", { name: "Restore access", exact: true })
    .click();
  await page.getByLabel(/^Reason/).fill("Review complete");
  await page
    .getByRole("button", { name: "Restore subscription", exact: true })
    .click();
  await expect(row).toContainText(/trial/i);
  await row
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Delete tenant account",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const deleteButton = dialog.getByRole("button", {
    name: "Delete account",
    exact: true,
  });
  await expect(dialog.locator("input")).toHaveCount(1);
  await expect(
    dialog.locator("input[type=email],input[type=password],textarea"),
  ).toHaveCount(0);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Retype the school name to confirm deletion.",
  );
  await expect(
    dialog.getByLabel("Retype the school name", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Retype the school name", { exact: true })
    .fill("Wrong school");
  await deleteButton.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "The school name does not match.",
  );
  await dialog
    .getByLabel("Retype the school name", { exact: true })
    .fill(f.school.name);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(deleteButton).toBeEnabled();
  await mkdir("test-results/owner-tenant-actions", { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const issues = await dialog.evaluate((el) => {
      const body = el.querySelector(".modal-body").getBoundingClientRect();
      return [
        ...el.querySelectorAll("input,textarea,.tenant-delete-footer button"),
      ]
        .filter((field) => {
          const r = field.getBoundingClientRect();
          return r.left < body.left + 12 || r.right > body.right - 12;
        })
        .map((el) => el.tagName);
    });
    assert.deepEqual(issues, [], "Deletion controls touch section edges");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `test-results/owner-tenant-actions/delete-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await dialog
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(/deleted/i);
  const recovery = page.locator(".panel").filter({
    has: page.getByRole("heading", {
      name: "Deleted accounts & closure requests",
      exact: true,
    }),
  });
  await expect(
    recovery.getByRole("row").filter({ hasText: "Greenfield Academy" }),
  ).toContainText(/deleted/i);
  await recovery
    .getByRole("button", { name: "Reactivate account", exact: true })
    .click();
  await page.getByLabel(/^Reason/).fill("School returned");
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(row).toContainText(/trial/i);
  await expect(recovery).toHaveCount(0);
  const sub = await one(
    f.db,
    "SELECT closed_at FROM school_subscriptions WHERE school_id=$1",
    [f.school.id],
  );
  assert.equal(sub.closed_at, null);
  assert.deepEqual(errors, []);
  console.log(
    "Owner tenant actions passed: suspend, restore, school-name-only deletion confirmation, closure, refreshed recovery list and reactivation; desktop and mobile padding.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.db.close();
}
