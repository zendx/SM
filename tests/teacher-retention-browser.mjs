import { teacherRetentionFixture } from "./teacher-retention-fixture.js";
import { serveFrontend } from "../server/frontend.js";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
const f = await teacherRetentionFixture();
serveFrontend(f.app, path.resolve("dist"));
const server = f.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const errors = [];
await mkdir("test-results/teacher-retention", { recursive: true });
async function login(who, route) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await page.request.post(origin + "/api/v1/auth/login", {
    data: { email: f.users[who].email, password: f.password },
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
async function modalInsets(page) {
  const issues = await page.getByRole("dialog").evaluate((el) => {
    const body = el.querySelector(".modal-body").getBoundingClientRect();
    return [
      ...el.querySelectorAll(
        "input:not([type=checkbox]),textarea,.teacher-removal-footer button,.retained-record-actions button",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width && (r.left < body.left + 12 || r.right > body.right - 12)
        );
      })
      .map((el) => el.tagName);
  });
  assert.deepEqual(issues, [], "Modal controls touch section edges");
}
try {
  const tenant = await login("tenant", "/greenfield/#administration/users");
  await expect(
    tenant.getByRole("button", { name: "Delete teacher", exact: true }),
  ).toBeVisible();
  await tenant.goto(origin + "/greenfield/#staff");
  const row = tenant.getByRole("row").filter({ hasText: "Mariam Bello" });
  await row
    .getByRole("button", { name: "Delete profile", exact: true })
    .click();
  await tenant
    .getByLabel("Reason for removal", { exact: true })
    .fill("Employment contract ended");
  await tenant
    .getByRole("checkbox", { name: /I understand this teacher/ })
    .check();
  for (const width of [1440, 390, 320]) {
    await tenant.setViewportSize({ width, height: 1000 });
    await modalInsets(tenant);
    await tenant.screenshot({
      path: `test-results/teacher-retention/removal-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await tenant
    .getByRole("dialog")
    .getByRole("button", { name: "Delete teacher profile", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await tenant.goto(origin + "/greenfield/#administration/users");
  await expect(
    tenant.getByRole("heading", { name: "User accounts", exact: true }),
  ).toBeVisible();
  await expect(tenant.getByText("Mariam Bello", { exact: true })).toHaveCount(
    0,
  );
  const owner = await login("owner", "/owner#users");
  await expect(owner.locator(".school-account-card")).toHaveCount(2);
  await expect(owner.getByText("Mariam Bello", { exact: true })).toHaveCount(0);
  const heading = owner.getByRole("button", { name: /Greenfield Academy/ });
  await heading.click();
  const users = owner.getByRole("region", {
    name: "Greenfield Academy accounts",
    exact: true,
  });
  await expect(users.locator(".school-user-row")).toHaveCount(3);
  await expect(users.getByText("Ada Okafor", { exact: true })).toBeVisible();
  await expect(
    users.getByText("Other Administrator", { exact: true }),
  ).toHaveCount(0);
  await users
    .getByLabel("Filter role in Greenfield Academy")
    .selectOption("PARENT");
  await expect(users.locator(".school-user-row")).toHaveCount(1);
  await users.getByLabel("Filter role in Greenfield Academy").selectOption("");
  for (const width of [1440, 390, 320]) {
    await owner.setViewportSize({ width, height: 1000 });
    await expect(users.locator(".school-user-row")).toHaveCount(3);
    assert.ok(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Customer accounts overflow",
    );
    await owner.screenshot({
      path: `test-results/teacher-retention/grouped-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await users.getByRole("button", { name: /Retained teachers/ }).click();
  await expect(users.locator(".school-user-row")).toHaveCount(1);
  await users
    .getByRole("button", { name: "View retained record", exact: true })
    .click();
  const dialog = owner.getByRole("dialog", {
    name: "Retained teacher record",
    exact: true,
  });
  await expect(dialog).toContainText("B.Ed Mathematics");
  await expect(dialog).toContainText("Employment contract ended");
  await modalInsets(owner);
  await owner.screenshot({
    path: "test-results/teacher-retention/retained-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  const exportWait = owner.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download retained record", exact: true })
    .click();
  const exported = await exportWait;
  const data = JSON.parse(await readFile(await exported.path(), "utf8"));
  assert.equal(data.user.id, f.users.teacher.id);
  assert.equal(data.attendance.length, 1);
  assert.ok(!JSON.stringify(data).includes("password_hash"));
  const documentWait = owner.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download document", exact: true })
    .click();
  const doc = await documentWait;
  assert.equal(
    await readFile(await doc.path(), "utf8"),
    "%PDF-retained-contract",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await owner
    .getByLabel("Search customer schools", { exact: true })
    .fill("Mariam");
  await expect(owner.locator(".school-account-card")).toHaveCount(1);
  await expect(
    owner.getByRole("button", { name: /Greenfield Academy/ }),
  ).toHaveAttribute("aria-expanded", "false");
  assert.deepEqual(errors, []);
  console.log(
    "Teacher removal and school-grouped customer accounts passed: tenant hiding, role filters, retained records, JSON/original document downloads and responsive padding.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.db.close();
}
