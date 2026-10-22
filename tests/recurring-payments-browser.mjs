import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { serveFrontend } from "../server/frontend.js";
import { insert, one } from "../server/db.js";
import { digest } from "../server/security.js";
import { saveProvider } from "../server/saas-providers.js";
import { saveRecurringMethod } from "../server/recurring-methods.js";

process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const db = await openTestDatabase();
const originalFetch = globalThis.fetch;
let server, browser, checkout;
let checkoutCount = 0;
try {
  const app = await createApp(db);
  const school = await insert(db, "schools", { name: "Renewal Academy", short_code: "RENEW", portal_slug: "renewal-academy" });
  const user = await insert(db, "users", { school_id: school.id, name: "Tenant", email: "admin@renewal.test", role: "SUPER_ADMIN", password_hash: "unused" });
  await db.query("INSERT INTO school_subscriptions(school_id,plan,status,period_end) VALUES($1,'PRO','ACTIVE',now()+interval '1 month') ON CONFLICT DO NOTHING", [school.id]);
  await saveProvider(db, "stripe", { enabled: true, mode: "LIVE", secret_key: "sk_live_browser", webhook_secret: "whsec_browser" });
  const token = "recurring-browser-session";
  await insert(db, "sessions", { user_id: user.id, token_hash: digest(token), csrf: token, mfa_verified: true, expires_at: new Date(Date.now() + 300000) });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.stripe.com/")) {
      checkout = Object.fromEntries(new URLSearchParams(options.body));
      return new Response(JSON.stringify({ id: `cs_authorized_${++checkoutCount}`, url: "https://checkout.stripe.com/c/pay/authorized" }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  serveFrontend(app, path.resolve("dist"));
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: "smpis_session", value: token, url: origin }]);
  await context.route("https://checkout.stripe.com/**", route => route.fulfill({ contentType: "text/html", body: "<p>Secure checkout</p>" }));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/renewal-academy/#subscription");
  const consent = page.getByRole("checkbox", { name: /Authorize this card/ });
  await consent.waitFor();
  assert.equal(await consent.isChecked(), true);
  await page.getByText("Authorize this card for automatic renewal at the amount shown at checkout.", { exact: true }).waitFor();
  await consent.uncheck();
  await page.getByRole("button", { name: "Pay by card", exact: false }).click();
  await page.waitForURL("https://checkout.stripe.com/**");
  assert.equal(checkout["payment_intent_data[setup_future_usage]"], undefined);
  assert.equal((await one(db, "SELECT auto_renew_requested FROM subscription_payments WHERE school_id=$1 ORDER BY id DESC LIMIT 1", [school.id])).auto_renew_requested, false);
  await page.goto(origin + "/renewal-academy/#subscription");
  await consent.waitFor();
  assert.equal(await consent.isChecked(), true);
  await page.getByRole("button", { name: "Pay by card", exact: false }).click();
  await page.waitForURL("https://checkout.stripe.com/**");
  assert.equal(checkout["payment_intent_data[setup_future_usage]"], "off_session");
  assert.equal(checkout.customer_creation, "always");
  const payment = await one(db, "UPDATE subscription_payments SET status='PAID' WHERE school_id=$1 AND auto_renew_requested=true RETURNING *", [school.id]);
  assert.equal(payment.auto_renew_requested, true);
  await saveRecurringMethod(db, payment, { customer: "cus_authorized", payment_method: "pm_authorized" }, { brand: "Visa", last4: "4242" });
  await page.goto(origin + "/renewal-academy/#subscription");
  await page.getByText(/Your Visa card ending 4242 is authorized/).waitFor();
  await page.getByRole("button", { name: "Turn off automatic renewal" }).click();
  await page.getByText("Automatic renewal is off. Authorize your card with your next payment to enable it.").waitFor();
  assert.equal((await one(db, "SELECT enabled FROM subscription_auto_renewals WHERE school_id=$1", [school.id])).enabled, false);
  assert.deepEqual(errors, []);
  console.log("Tenant can opt out of default recurring checkout, sees saved card, and can revoke auto-renewal.");
} finally {
  globalThis.fetch = originalFetch;
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
}
