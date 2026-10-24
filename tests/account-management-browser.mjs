import { accountFixture } from "./account-fixture.js";
import { serveFrontend } from "../server/frontend.js";
import { one } from "../server/db.js";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const fixture = await accountFixture();
serveFrontend(fixture.app, path.resolve("dist"));
const server = fixture.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "chrome" } : {}),
});
const errors = [];
await mkdir("test-results/account-management", { recursive: true });
async function checkInsets(page) {
  const issues = await page.locator(".account-profile").evaluate((form) => {
    const body = form.closest(".modal-body").getBoundingClientRect();
    return [
      ...form.querySelectorAll(
        "input,textarea,button,.account-profile-summary",
      ),
    ].flatMap((el) => {
      const r = el.getBoundingClientRect();
      return r.left < body.left + 12 || r.right > body.right - 12
        ? [`${el.tagName}: ${r.left - body.left}, ${body.right - r.right}`]
        : [];
    });
  });
  assert.deepEqual(
    issues,
    [],
    "Profile controls need room inside their section",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page overflows viewport",
  );
}
try {
  for (const who of ["tenant", "owner"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    const login = await page.request.post(origin + "/api/v1/auth/login", {
      data: { email: fixture.users[who].email, password: fixture.password },
    });
    assert.equal(login.status(), 200, await login.text());
    const route =
      who === "owner" ? "/owner#overview" : "/greenfield/#dashboard";
    await page.goto(origin + route);
    const cookies = page.getByRole("button", {
      name: "Accept required cookies",
      exact: true,
    });
    if (await cookies.isVisible()) await cookies.click();
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Account menu for/ }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: /Account menu for/ })
      .press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: /Account management/ }),
    ).toBeFocused();
    await page.keyboard.press("End");
    await expect(
      page.getByRole("menuitem", { name: "Sign out", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByLabel("Email address", { exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(page.getByLabel("Email address", { exact: true })).toHaveValue(
      fixture.users[who].email,
    );
    const updatedName =
      who === "owner" ? "Ada Platform Owner" : "Grace Updated";
    await page.getByLabel("Full name").fill(updatedName);
    await page
      .getByLabel("Phone number", { exact: true })
      .fill("+234 802 987 6543");
    await page
      .getByLabel("Address", { exact: true })
      .fill("12 School Road\nLagos, Nigeria");
    await checkInsets(page);
    await page.screenshot({
      path: `test-results/account-management/${who}-desktop.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Your account details have been saved",
    );
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: `Account menu for ${updatedName}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", {
        name: `Account menu for ${updatedName}`,
        exact: true,
      })
      .click();
    await page.getByRole("menuitem", { name: /Account management/ }).click();
    await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
      "12 School Road\nLagos, Nigeria",
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await checkInsets(page);
      await page.screenshot({
        path: `test-results/account-management/${who}-profile-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Done", exact: true }).click();
      const trigger = page.getByRole("button", { name: /Account menu for/ });
      await expect(trigger).toBeVisible();
      const triggerBox = await trigger.boundingBox();
      assert.ok(
        triggerBox.x >= 12 && triggerBox.x + triggerBox.width <= width - 12,
        "Account trigger touches viewport edge",
      );
      await trigger.click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      assert.ok(
        box.x >= 12 && box.x + box.width <= width - 12,
        "Dropdown touches viewport edge",
      );
      await page.screenshot({
        path: `test-results/account-management/${who}-menu-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.getByRole("menuitem", { name: /Account management/ }).click();
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    if (who === "owner") {
      await page.getByRole("button", { name: /Account menu for/ }).click();
      await page.getByRole("menuitem", { name: /Account security/ }).click();
      await expect(
        page.getByText("Owner account security", { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Account menu for/ }),
    ).toHaveCount(0);
    const row = await one(
      fixture.db,
      "SELECT name,email,address FROM users WHERE id=$1",
      [fixture.users[who].id],
    );
    assert.equal(row.name, updatedName);
    assert.equal(row.email, fixture.users[who].email);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Account management passed for tenant and owner: profile persistence, fixed email, keyboard dropdown, logout, desktop/mobile layout and section padding.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await fixture.db.close();
}
