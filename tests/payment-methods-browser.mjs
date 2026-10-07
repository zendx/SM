import assert from "node:assert/strict";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium } from "@playwright/test";
import { openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { hashPassword } from "../server/security.js";

process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const db = await openTestDatabase(),
  app = await createApp(db),
  password = "Payment-browser-2026!";
serveFrontend(app, path.resolve("dist"));
const owner = await insert(db, "users", {
  school_id: null,
  name: "Owner",
  email: "owner@payments.test",
  role: "PLATFORM_OWNER",
  password_hash: hashPassword(password),
});
await insert(db, "platform_operators", { user_id: owner.id });
const school = await insert(db, "schools", {
  name: "Payments Academy",
  short_code: "PAY",
  portal_slug: "payments-academy",
  currency_code: "USD",
});
await insert(db, "users", {
  school_id: school.id,
  name: "Admin",
  email: "admin@payments.test",
  role: "SUPER_ADMIN",
  password_hash: hashPassword(password),
});
const year = await insert(db, "academic_years", {
  school_id: school.id,
  name: "2026",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
});
const term = await insert(db, "terms", {
  school_id: school.id,
  academic_year_id: year.id,
  name: "Term",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  is_current: true,
});
const student = await insert(db, "students", {
  school_id: school.id,
  first_name: "Student",
  last_name: "One",
  guardian_name: "Parent",
  guardian_phone: "123456789",
  gender: "OTHER",
  date_of_birth: "2015-01-01",
});
await insert(db, "student_invoices", {
  school_id: school.id,
  student_id: student.id,
  term_id: term.id,
  invoice_number: "PAY-001",
  total_cents: 10000,
  due_date: "2026-12-31",
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    }),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log(e.message);
  });
  async function login(email, route) {
    await page.context().clearCookies();
    await page.goto(origin + route);
    await page.getByLabel("Email address").fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page
      .getByRole("button", {
        name:
          route === "/owner"
            ? "Sign in to owner dashboard"
            : "Sign in to your workspace",
        exact: true,
      })
      .click();
  }
  await login("admin@payments.test", "/payments-academy/#subscription");
  await page
    .getByText(
      "Subscription payments are not available yet. Contact SMPIS support.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Pay by card", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Pay by bank transfer", exact: true })
      .count(),
    0,
  );
  await login("owner@payments.test", "/owner");
  await page
    .getByRole("button", { name: "Payment settings", exact: true })
    .click();
  await page.getByLabel("Bank name", { exact: true }).fill("Owner Bank");
  await page.getByLabel("Account name", { exact: true }).fill("SMPIS");
  await page.getByLabel("Account number", { exact: true }).fill("123456789");
  await page
    .getByLabel("Manual subscription payments available (live)")
    .check();
  await page
    .getByRole("button", {
      name: "Save bank & subscription settings",
      exact: true,
    })
    .click();
  await page.getByText("Payment settings updated.", { exact: true }).waitFor();
  await login("admin@payments.test", "/payments-academy/#subscription");
  await page
    .getByRole("heading", { name: "Pay by bank transfer", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Pay by card", exact: true })
      .count(),
    0,
  );
  await page.goto(origin + "/payments-academy/#administration");
  await page
    .getByRole("button", { name: /integrations/i, exact: true })
    .click();
  for (const name of [
    "Manual fee payments",
    "PayPal",
    "Paystack",
    "Flutterwave",
    "Stripe",
  ])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  const manual = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Manual fee payments",
        exact: true,
      }),
    })
    .last();
  await manual.getByLabel("Bank name", { exact: true }).fill("School Bank");
  await manual
    .getByLabel("Account name", { exact: true })
    .fill("Payments Academy");
  await manual.getByLabel("Account number", { exact: true }).fill("999999999");
  await manual.getByLabel("Enable this integration").check();
  await manual.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText("Manual fee payments settings saved", { exact: true })
    .waitFor();
  await page.goto(origin + "/payments-academy/#finance");
  await page
    .getByRole("button", { name: "Make a fee payment", exact: true })
    .click();
  await page
    .locator("dialog")
    .getByLabel("Invoice", { exact: false })
    .selectOption({ index: 1 });
  await page.getByLabel("Payment amount", { exact: false }).fill("10");
  await page
    .getByLabel("Bank transfer reference", { exact: false })
    .fill("SCHOOL-TRANSFER");
  await page
    .getByRole("button", {
      name: "Submit transfer for confirmation",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm bank receipt", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm funds received", exact: true })
    .click();
  await page
    .getByText("Payment verified and credited to the invoice.", { exact: true })
    .waitFor();
  assert.equal(
    Number(
      (
        await one(
          db,
          "SELECT paid_cents FROM student_invoices WHERE invoice_number='PAY-001'",
        )
      ).paid_cents,
    ),
    1000,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chrome verifies owner subscription publication and independent school fee settings and manual receipt approval.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
