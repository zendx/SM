import { testMailbox } from "./mailbox.js";
const verifyFixtureEmail = testMailbox();
import { test as unitTest } from "node:test";
import { test, before, after, openTestDatabase } from "./database.js";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";
import { initializeSchema } from "../server/schema.js";
import { runJobs } from "../server/jobs.js";
import {
  accessAllowed,
  nextPeriod,
  price,
  settleSubscriptionPayment,
} from "../server/saas-service.js";
import {
  verifyStripeSignature,
  verifyCheckout,
} from "../server/saas-routes.js";
import {
  providerConfig,
  chargeQuote,
  verifyPaystackSignature,
  verifyAlternativePayment,
} from "../server/saas-providers.js";

unitTest(
  "trial expiry, paid grace period, calendar renewals and yearly pricing",
  () => {
    assert.equal(price("MONTHLY"), 10000);
    assert.equal(price("YEARLY"), 102000);
    const now = new Date("2026-10-06T12:00:00Z");
    assert.equal(
      accessAllowed(
        { plan: "FREE", status: "TRIAL", period_end: now },
        30,
        now,
      ),
      false,
    );
    assert.equal(
      accessAllowed({ plan: "PRO", status: "ACTIVE", period_end: now }, 1, now),
      true,
    );
    assert.equal(
      accessAllowed(
        { plan: "PRO", status: "SUSPENDED", period_end: "2099-01-01" },
        30,
        now,
      ),
      false,
    );
    assert.equal(
      nextPeriod("2027-01-31T12:00:00Z", "MONTHLY").toISOString(),
      "2027-02-28T12:00:00.000Z",
    );
    assert.equal(
      nextPeriod("2028-02-29T12:00:00Z", "YEARLY").toISOString(),
      "2029-02-28T12:00:00.000Z",
    );
    assert.deepEqual(chargeQuote(102000, { currency: "NGN", usd_rate: 1500 }), {
      charge_amount_cents: 153000000,
      charge_currency: "NGN",
    });
  },
);
unitTest(
  "webhook signatures reject tampering, old events and missing secrets",
  () => {
    const raw = Buffer.from('{"ok":true}'),
      stamp = Math.floor(Date.now() / 1000),
      secret = "whsec_sample";
    const sig = createHmac("sha256", secret)
      .update(`${stamp}.`)
      .update(raw)
      .digest("hex");
    assert.equal(
      verifyStripeSignature(raw, `t=${stamp},v1=${sig}`, secret),
      true,
    );
    assert.equal(
      verifyStripeSignature(Buffer.from("{}"), `t=${stamp},v1=${sig}`, secret),
      false,
    );
    assert.equal(
      verifyStripeSignature(
        raw,
        `t=${stamp},v1=${sig}`,
        secret,
        (stamp + 301) * 1000,
      ),
      false,
    );
    assert.equal(verifyStripeSignature(raw, "", ""), false);
    const ps = createHmac("sha512", "sk_test_x").update(raw).digest("hex");
    assert.equal(verifyPaystackSignature(raw, ps, "sk_test_x"), true);
    assert.equal(
      verifyPaystackSignature(Buffer.from("{}"), ps, "sk_test_x"),
      false,
    );
  },
);
process.env.REQUIRE_MFA = "false";
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
let db, server, base, owner, free, pro, schoolId, paymentId;
const password = "SaaS-test-password-2026!";
const registration = (slug, plan = "FREE") => ({
  school_name: slug + " Academy", phone_number: "+2348012345678",
  portal_slug: slug,
  name: "School admin",
  email: slug + "@saas.test",
  password,
  plan,
  billing_cycle: "MONTHLY",
  year_name: "2026/27",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
});
async function request(path, { client, method = "GET", body, portal } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(client ? { Cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(portal ? { "x-smpis-portal": portal } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}
async function login(email, portal) {
  await verifyFixtureEmail(email, base);
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(portal ? { "x-smpis-portal": portal } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  return { ...json.data, cookie: res.headers.get("set-cookie").split(";")[0] };
}
before(async () => {
  db = await openTestDatabase();
  const app = await createApp(db);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});
test("public signup cannot bootstrap an owner; owner setup remains one-time", async () => {
  assert.equal(
    (
      await request("/saas/register", {
        method: "POST",
        body: registration("early"),
      })
    ).status,
    503,
  );
  const result = await request("/auth/setup", {
    method: "POST",
    body: {
      school_name: "Owner", phone_number: "+2348012345678",
      short_code: "OWNER",
      currency_code: "NGN",
      timezone: "Africa/Lagos",
      name: "Owner",
      email: "owner@saas.test",
      password,
      year_name: "2026/27",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  owner = await login("owner@saas.test");
  assert.equal(owner.user.platform_operator, true);
});
test("self signup gives 30-day school portal without owner privileges; Pro waits for payment", async () => {
  const result = await request("/saas/register", {
    method: "POST",
    body: registration("greenfield"),
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  schoolId = result.data.school.id;
  assert.equal(result.data.portal_url, "/greenfield/");
  free = await login("greenfield@saas.test", "greenfield");
  assert.equal(free.user.platform_operator, false);
  const s = await request("/subscription", { client: free });
  assert.equal(s.data.status, "TRIAL");
  const created = await one(db, "SELECT created_at FROM schools WHERE id=$1", [
    schoolId,
  ]);
  assert.ok(
    Math.abs(
      (new Date(s.data.period_end) - new Date(created.created_at)) / 86400000 -
        30,
    ) < 0.0001,
  );
  assert.equal((await request("/saas/owner", { client: free })).status, 403);
  assert.equal(
    (
      await request("/saas/register", {
        method: "POST",
        body: registration("api"),
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request("/saas/register", {
        method: "POST",
        body: registration("greenfield"),
      })
    ).status,
    409,
  );
  const paid = await request("/saas/register", {
    method: "POST",
    body: registration("proschool", "PRO"),
  });
  assert.equal(paid.status, 201);
  pro = await login("proschool@saas.test");
  assert.equal((await request("/students", { client: pro })).status, 402);
  assert.equal((await request("/subscription", { client: pro })).status, 200);
});
test("portal checks and school record queries prevent cross-school access", async () => {
  assert.equal(
    (await request("/students", { client: free, portal: "proschool" })).status,
    403,
  );
  assert.equal(
    (await request("/me", { client: free, portal: "greenfield" })).status,
    200,
  );
  const own = await request("/config", { client: free });
  assert.equal(own.data.school.id, schoolId);
  const wrong = await request("/auth/login", {
    method: "POST",
    portal: "proschool",
    body: { email: "greenfield@saas.test", password },
  });
  assert.equal(wrong.status, 403);
});
test("trial auto suspension blocks an existing session but preserves billing and records", async () => {
  await db.query(
    "UPDATE school_subscriptions SET period_end=now()-interval '1 second' WHERE school_id=$1",
    [schoolId],
  );
  assert.equal((await request("/students", { client: free })).status, 402);
  assert.equal(
    (await request("/subscription", { client: free })).data.suspension_reason,
    "TRIAL_EXPIRED",
  );
  assert.equal((await request("/config", { client: free })).status, 200);
  assert.equal((await request("/me", { client: free })).status, 200);
  assert.equal((await request("/saas/owner", { client: owner })).status, 200);
  const events = await one(
    db,
    "SELECT count(*)::int AS n FROM subscription_events WHERE school_id=$1 AND action='AUTO_SUSPENDED'",
    [schoolId],
  );
  assert.equal(events.n, 1);
});
test("manual yearly approval is idempotent, restores expired access, and audits revenue", async () => {
  const result = await request("/saas/owner/settings", {
    client: owner,
    method: "PATCH",
    body: {
      bank_name: "Test Bank",
      account_name: "SMPIS",
      account_number: "1234567890",
      bank_currency: "NGN",
      bank_usd_rate: 1500,
      landing_currency: "NGN",
      landing_usd_rate: 1500,
      bank_instructions: "Use your school name.",
      grace_days: 2,
    },
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  const payment = await request("/subscription/bank", {
    client: free,
    method: "POST",
    body: {
      billing_cycle: "YEARLY",
      transfer_reference: "TRANSFER-1",
      note: "Annual payment",
    },
  });
  assert.equal(payment.status, 201, JSON.stringify(payment));
  paymentId = payment.data.id;
  assert.equal(payment.data.amount_cents, 102000);
  assert.equal(Number(payment.data.charge_amount_cents), 153000000);
  const duplicate = await request("/subscription/bank", {
    client: free,
    method: "POST",
    body: { billing_cycle: "YEARLY", transfer_reference: "transfer-1" },
  });
  assert.equal(duplicate.status, 409);
  const approved = await request(`/saas/owner/payments/${paymentId}/review`, {
    client: owner,
    method: "POST",
    body: { decision: "APPROVE", note: "Confirmed bank statement" },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  assert.equal(approved.data.status, "PAID");
  const snapshot = await request("/subscription", { client: free });
  assert.equal(snapshot.data.status, "ACTIVE");
  assert.equal(snapshot.data.billing_cycle, "YEARLY");
  const end = snapshot.data.period_end;
  await settleSubscriptionPayment(db, paymentId, owner.user.id);
  assert.equal(
    (await request("/subscription", { client: free })).data.period_end,
    end,
  );
  const dashboard = await request("/saas/owner", { client: owner });
  assert.equal(Number(dashboard.data.revenue.received_cents), 102000);
  assert.equal((await request("/students", { client: free })).status, 200);
  const renewed = await request("/subscription/bank", {
    client: free,
    method: "POST",
    body: { billing_cycle: "MONTHLY", transfer_reference: "TRANSFER-2" },
  });
  const [a, b] = await Promise.all([
    settleSubscriptionPayment(db, renewed.data.id, owner.user.id),
    settleSubscriptionPayment(db, renewed.data.id, owner.user.id),
  ]);
  assert.equal(a.status, "PAID");
  assert.equal(b.status, "PAID");
  assert.equal(
    (await request("/subscription", { client: free })).data.period_end,
    nextPeriod(end, "MONTHLY").toISOString(),
  );
});
test("provider secrets are encrypted, redacted and sandbox-only until explicitly configured live", async () => {
  for (const provider of ["stripe", "paystack", "flutterwave"]) {
    const body = {
      enabled: true,
      mode: "SANDBOX",
      currency: provider === "stripe" ? "USD" : "NGN",
      usd_rate: 1500,
      secret_key:
        provider === "flutterwave" ? "FLWSECK-sample_TEST" : "sk_test_sample",
      webhook_secret: "test_webhook_secret",
    };
    const res = await request("/saas/owner/providers/" + provider, {
      client: owner,
      method: "PATCH",
      body,
    });
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal(res.data.secret_key, undefined);
    assert.equal(res.data.secret_key_configured, true);
    const stored = await one(
      db,
      "SELECT encrypted_config FROM saas_payment_providers WHERE provider=$1",
      [provider],
    );
    assert.ok(!stored.encrypted_config.includes(body.secret_key));
    assert.equal(
      (await providerConfig(db, provider)).secret_key,
      body.secret_key,
    );
    const live = await request("/saas/owner/providers/" + provider, {
      client: owner,
      method: "PATCH",
      body: { ...body, mode: "LIVE" },
    });
    assert.equal(live.status, 422);
  }
  assert.equal(
    (
      await request("/saas/owner/providers/stripe", {
        client: free,
        method: "PATCH",
        body: {},
      })
    ).status,
    403,
  );
});
test("sandbox Stripe, Paystack and Flutterwave verification rejects mismatches and never credits live access", async () => {
  const { data: sub } = await request("/subscription", { client: pro });
  const p = await one(
    db,
    "INSERT INTO subscription_payments(school_id,reference,billing_cycle,amount_cents,method,provider,provider_id,initiated_by,charge_amount_cents,charge_currency) VALUES($1,'STRIPE-TEST','MONTHLY',10000,'CARD','stripe','cs_test_sample',$2,10000,'USD') RETURNING *",
    [sub.school_id, pro.user.id],
  );
  const session = {
    id: "cs_test_sample",
    client_reference_id: "STRIPE-TEST",
    metadata: { school_id: String(sub.school_id) },
    currency: "usd",
    amount_total: 10000,
    payment_status: "paid",
    livemode: false,
  };
  await assert.rejects(() =>
    verifyCheckout(db, { ...session, amount_total: 1 }),
  );
  const verified = await verifyCheckout(db, session);
  assert.equal(verified.status, "TEST_CONFIRMED");
  assert.equal(
    (await request("/subscription", { client: pro })).data.status,
    "PENDING_PAYMENT",
  );
  const originalFetch = globalThis.fetch;
  try {
    for (const provider of ["paystack", "flutterwave"]) {
      await db.query(
        "INSERT INTO subscription_payments(school_id,reference,billing_cycle,amount_cents,method,provider,initiated_by,charge_amount_cents,charge_currency) VALUES($1,$2,'MONTHLY',10000,'CARD',$3,$4,15000000,'NGN')",
        [sub.school_id, provider + "-test", provider, pro.user.id],
      );
      const data =
        provider === "paystack"
          ? {
              id: 12,
              reference: provider + "-test",
              amount: 15000000,
              currency: "NGN",
              status: "success",
              domain: "test",
            }
          : {
              id: 13,
              tx_ref: provider + "-test",
              amount: 150000,
              currency: "NGN",
              status: "successful",
            };
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: provider === "paystack" ? true : "success",
            data,
          }),
          { status: 200 },
        );
      const confirmed = await verifyAlternativePayment(
        db,
        provider,
        provider === "paystack" ? data.reference : "13",
        sub.school_id,
      );
      assert.equal(confirmed.status, "TEST_CONFIRMED");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    Number(
      (await request("/saas/owner", { client: owner })).data.revenue
        .received_cents,
    ),
    112000,
  );
});
test("manual suspension, restoration and termination preserve explicit owner control", async () => {
  const change = (body) =>
    request(`/saas/owner/tenants/${schoolId}`, {
      client: owner,
      method: "PATCH",
      body,
    });
  assert.equal(
    (await change({ action: "SUSPEND", reason: "Owner review" })).status,
    200,
  );
  assert.equal((await request("/students", { client: free })).status, 402);
  assert.equal(
    (
      await request("/subscription/bank", {
        client: free,
        method: "POST",
        body: { billing_cycle: "MONTHLY", transfer_reference: "BLOCKED" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await change({ action: "RESTORE", reason: "Review resolved" })).status,
    200,
  );
  assert.equal((await request("/students", { client: free })).status, 200);
  assert.equal(
    (await change({ action: "TERMINATE", reason: "Agreement ended" })).status,
    200,
  );
  assert.equal(
    (await change({ action: "RESTORE", reason: "Attempt restore" })).status,
    422,
  );
  assert.ok(await one(db, "SELECT id FROM schools WHERE id=$1", [schoolId]));
  const ownerSchool = owner.user.school_id;
  assert.equal(
    (
      await request(`/saas/owner/tenants/${ownerSchool}`, {
        client: owner,
        method: "PATCH",
        body: { action: "TERMINATE", reason: "Do not lock owner" },
      })
    ).status,
    422,
  );
});
test("schema migration is repeatable without resetting subscriptions", async () => {
  await initializeSchema(db);
  assert.equal(
    (
      await one(
        db,
        "SELECT status FROM school_subscriptions WHERE school_id=$1",
        [schoolId],
      )
    ).status,
    "TERMINATED",
  );
});
test("renewal reminders are deduplicated and owner CSV exports include the ledger safely", async () => {
  const created = await request("/saas/owner/tenants", {
    client: owner,
    method: "POST",
    body: registration("reminder-school"),
  });
  assert.equal(created.status, 201);
  await db.query(
    "UPDATE school_subscriptions SET period_end=now()+interval '3 days'-interval '1 second' WHERE school_id=$1",
    [created.data.school.id],
  );
  await runJobs(db);
  await runJobs(db);
  const count = await one(
    db,
    "SELECT count(*)::int AS n FROM notifications WHERE school_id=$1 AND dedupe_key LIKE 'saas-reminder:%'",
    [created.data.school.id],
  );
  assert.equal(count.n, 1);
  await db.query("UPDATE subscription_payments SET note=$2 WHERE id=$1", [
    paymentId,
    '=HYPERLINK("https://example.invalid")',
  ]);
  const csv = await fetch(base + "/saas/owner/export?kind=payments", {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  const content = await csv.text();
  assert.ok(content.includes("STRIPE-TEST"));
  assert.ok(content.includes("'=HYPERLINK"));
  const reminderAdmin = await login("reminder-school@saas.test");
  const denied = await fetch(base + "/saas/owner/export?kind=audit", {
    headers: { Cookie: reminderAdmin.cookie },
  });
  assert.equal(denied.status, 403);
  const tenantDenied = await fetch(base + "/saas/owner/export?kind=audit", {
    headers: { Cookie: pro.cookie },
  });
  assert.equal(tenantDenied.status, 402);
});
test("owner restoration cannot extend a Free trial beyond 30 days", async () => {
  const school = await one(
    db,
    "SELECT id FROM schools WHERE portal_slug='reminder-school'",
  );
  const r = await request(`/saas/owner/tenants/${school.id}`, {
    client: owner,
    method: "PATCH",
    body: {
      action: "RESTORE",
      reason: "Invalid extension",
      access_until: new Date(Date.now() + 31 * 86400000).toISOString(),
    },
  });
  assert.equal(r.status, 422);
});
test("owner workspace public admissions remain available after the subscription period", async () => {
  await db.query(
    "UPDATE school_subscriptions SET period_end=now()-interval '1 second' WHERE school_id=$1",
    [owner.user.school_id],
  );
  assert.equal((await request("/auth/public-admissions/OWNER")).status, 200);
  assert.equal(
    (await request("/subscription", { client: owner })).data.access_allowed,
    true,
  );
});
