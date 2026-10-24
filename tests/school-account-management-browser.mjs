import { teacherRetentionFixture } from "./teacher-retention-fixture.js";
import { serveFrontend } from "../server/frontend.js";
import { chromium, expect } from "@playwright/test";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const f = await teacherRetentionFixture();
f.users.finance = await insert(f.db, "users", {
  school_id: f.school.id,
  name: "Finance Officer",
  email: "finance@school-actions.test",
  role: "FINANCE_OFFICER",
  password_hash: hashPassword(f.password),
  email_verified: true,
});
serveFrontend(f.app, path.resolve("dist"));
const server = f.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const errors = [];
async function login(key, route) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await page.request.post(origin + "/api/v1/auth/login", {
    data: { email: f.users[key].email, password: f.password },
  });
  assert.equal(r.status(), 200);
  await page.goto(origin + route);
  const cookies = page.getByRole("button", {
    name: "Accept required cookies",
    exact: true,
  });
  if (await cookies.isVisible()) await cookies.click();
  return page;
}
async function padding(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Horizontal overflow",
  );
  const issues = await page.getByRole("dialog").evaluate((el) => {
    const b = el.querySelector(".modal-body").getBoundingClientRect();
    return [
      ...el.querySelectorAll(
        "input:not([type=checkbox]),select,textarea,.account-profile-footer button,.account-removal-footer button",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && (r.left < b.left + 12 || r.right > b.right - 12);
      })
      .map((el) => el.tagName);
  });
  assert.deepEqual(issues, [], "Controls touch section edges");
}
try {
  await mkdir("test-results/school-account-management", { recursive: true });
  const page = await login("tenant", "/greenfield/#administration/users");
  for (const key of ["parent", "proprietor", "finance", "teacher"]) {
    const account = f.users[key];
    const row = page.getByRole("row").filter({ hasText: account.email });
    await row
      .getByRole("button", { name: "Edit account", exact: true })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Edit school account",
      exact: true,
    });
    await expect(edit).toBeVisible();
    await expect(
      edit.getByLabel("Email address", { exact: true }),
    ).toHaveAttribute("readonly", "");
    await edit
      .getByLabel("Full name", { exact: true })
      .fill(account.name + " Updated");
    await edit
      .getByLabel("Phone number", { exact: true })
      .fill("+2348021234567");
    await edit
      .getByLabel("Address", { exact: true })
      .fill("12 School Road, Lagos");
    if (key === "finance")
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await padding(page);
        await page.screenshot({
          path: `test-results/school-account-management/edit-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    await edit
      .getByRole("button", { name: "Save account changes", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await expect(row).toContainText(account.name + " Updated");
    await row
      .getByRole("button", { name: "Suspend account", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Suspend account",
      exact: true,
    });
    await dialog
      .getByLabel("Reason for suspension", { exact: true })
      .fill("Access review");
    await dialog
      .getByRole("button", { name: "Suspend account", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Restore account", exact: true }),
    ).toBeVisible();
    await row
      .getByRole("button", { name: "Restore account", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Restore account access",
      exact: true,
    });
    await dialog
      .getByLabel("Reason for restoration", { exact: true })
      .fill("Review completed");
    await dialog
      .getByRole("button", { name: "Restore account", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: "Suspend account", exact: true }),
    ).toBeVisible();
    await row
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Delete account", exact: true });
    await dialog
      .getByLabel("Reason for removal", { exact: true })
      .fill("School no longer needs this account");
    await dialog
      .getByRole("checkbox", { name: /I understand this account/ })
      .check();
    await padding(page);
    if (key === "finance")
      await page.screenshot({
        path: "test-results/school-account-management/delete-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
    await dialog
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const archive = await one(
      f.db,
      "SELECT record FROM account_archives WHERE user_id=$1",
      [account.id],
    );
    assert.equal(archive.record.user.role, account.role);
  }
  const owner = await login("owner", "/owner#users");
  await owner.getByRole("button", { name: /Greenfield Academy/ }).click();
  const accounts = owner.getByRole("region", {
    name: "Greenfield Academy accounts",
    exact: true,
  });
  await accounts.getByRole("button", { name: /Retained accounts/ }).click();
  await expect(accounts.locator(".school-user-row")).toHaveCount(4);
  await accounts
    .locator(".school-user-row")
    .filter({ hasText: f.users.parent.email })
    .getByRole("button", { name: "View retained record", exact: true })
    .click();
  await expect(
    owner.getByRole("dialog", { name: "Retained account record", exact: true }),
  ).toContainText(f.users.parent.name + " Updated");
  assert.deepEqual(errors, []);
  console.log(
    "All-role account UI passed: parent, proprietor, finance and teacher edit/suspend/restore/delete; fixed emails, owner retention and mobile padding.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.db.close();
}
