import { testMailbox } from "./mailbox.js";
const verifyFixtureEmail = testMailbox();
import { randomBytes } from "node:crypto";
import { verifyCheckout } from "../server/saas-routes.js";
import * as OTPAuth from "otpauth";
import { test, before, after, openTestDatabase } from "./database.js";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";
import { digest } from "../server/security.js";
process.env.REQUIRE_MFA = "false";
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
let db, server, base, owner, school;
const password = "Owner-separation-test-2026!";
async function call(path, { client, method = "GET", body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(client ? { Cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}
async function login(email, path = "/auth/login") {
  await verifyFixtureEmail(email, base);
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
test("owner registration creates a business account without a school and restricts school APIs", async () => {
  assert.equal((await call("/auth/owner/setup")).data.required, true);
  assert.equal(
    (
      await call("/auth/owner/setup", {
        method: "POST",
        body: {
          name: "Owner",
          email: "owner@console.test",
          password,
          school_name: "Unexpected", phone_number: "+2348012345678",
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call("/auth/owner/setup", {
        method: "POST",
        body: { name: "Owner", email: "owner@console.test", password },
      })
    ).status,
    201,
  );
  for (const table of ["schools", "school_subscriptions", "academic_years"])
    assert.equal(
      Number((await one(db, `SELECT count(*) AS n FROM ${table}`)).n),
      0,
    );
  owner = await login("owner@console.test", "/auth/owner/login");
  assert.equal(owner.user.school_id, null);
  assert.equal(owner.user.platform_operator, true);
  assert.equal(owner.user.role, "PLATFORM_OWNER");
  assert.equal((await call("/auth/owner/setup")).data.required, false);
  assert.equal((await call("/auth/setup")).data.required, false);
  assert.equal(
    (
      await call("/auth/owner/setup", {
        method: "POST",
        body: { name: "Other", email: "other@console.test", password },
      })
    ).status,
    409,
  );
  assert.equal((await call("/config", { client: owner })).status, 403);
  assert.equal((await call("/subscription", { client: owner })).status, 403);
  const dashboard = await call("/saas/owner", { client: owner });
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard));
  assert.equal(dashboard.data.metrics.user_accounts, 0);
  assert.equal(dashboard.data.metrics.registered_schools, 0);
  assert.equal(dashboard.data.activity.length, 6);
});
test("owner metrics and support tools cover customer accounts with audited recovery and scoped issues", async () => {
  const body = {
    school_name: "Customer Academy", phone_number: "+2348012345678",
    portal_slug: "customer-academy",
    name: "School Admin",
    email: "admin@customer.test",
    password,
    plan: "FREE",
    billing_cycle: "MONTHLY",
    year_name: "2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  };
  const registration = await call("/saas/register", { method: "POST", body });
  assert.equal(registration.status, 201, JSON.stringify(registration));
  school = await login(body.email);
  const uid = school.user.id;
  assert.equal(
    (
      await call("/auth/owner/login", {
        method: "POST",
        body: { email: body.email, password },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("/saas/owner/users", { client: school })).status,
    403,
  );
  let dashboard = (await call("/saas/owner", { client: owner })).data;
  assert.equal(dashboard.metrics.registered_schools, 1);
  assert.equal(dashboard.metrics.user_accounts, 1);
  assert.equal(dashboard.metrics.paid_schools, 0);
  assert.equal(dashboard.metrics.trial_schools, 1);
  const list = await call("/saas/owner/users?search=customer", {
    client: owner,
  });
  assert.equal(list.data.total, 1);
  assert.equal(list.data.users[0].id, uid);
  assert.equal("password_hash" in list.data.users[0], false);
  const support = await call("/subscription/support", {
    client: school,
    method: "POST",
    body: {
      subject: "Cannot access my account",
      description: "I need help recovering access to an administrator account.",
    },
  });
  assert.equal(support.status, 201, JSON.stringify(support));
  dashboard = (await call("/saas/owner", { client: owner })).data;
  assert.equal(dashboard.metrics.open_issues, 1);
  assert.equal(
    (
      await call(`/saas/owner/issues/${support.data.id}`, {
        client: owner,
        method: "PATCH",
        body: { status: "RESOLVED", resolution: "" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(`/saas/owner/issues/${support.data.id}`, {
        client: owner,
        method: "PATCH",
        body: {
          status: "RESOLVED",
          resolution:
            "Verified the account holder and provided recovery instructions.",
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await call("/subscription/support", { client: school })).data[0].status,
    "RESOLVED",
  );
  assert.equal(
    (
      await call(`/saas/owner/users/${uid}/action`, {
        client: owner,
        method: "POST",
        body: {
          action: "UPDATE",
          status: "SUSPENDED",
          reason: "Account review",
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call(`/saas/owner/users/${uid}/action`, {
        client: owner,
        method: "POST",
        body: { action: "RESET_PASSWORD" },
      })
    ).status,
    422,
  );
  const recovery = await call(`/saas/owner/users/${uid}/action`, {
    client: owner,
    method: "POST",
    body: {
      action: "RESET_PASSWORD",
      reason: "Verified account holder identity",
    },
  });
  assert.equal(recovery.status, 200, JSON.stringify(recovery));
  assert.equal((await call("/me", { client: school })).status, 401);
  const raw = new URL(recovery.data.reset_url).searchParams.get("reset");
  const stored = await one(db, "SELECT * FROM reset_tokens WHERE user_id=$1", [
    uid,
  ]);
  assert.equal(stored.token_hash, digest(raw));
  assert.notEqual(stored.token_hash, raw);
  const events = await one(
    db,
    "SELECT details::text AS details FROM subscription_events WHERE action='USER_SUPPORT_ACTION' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(events.details.includes(raw), false);
  assert.equal(
    (
      await call("/auth/password-reset/confirm", {
        method: "POST",
        body: { token: raw, password },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/auth/password-reset/confirm", {
        method: "POST",
        body: { token: raw, password },
      })
    ).status,
    422,
  );
  school = await login(body.email);
  await db.query(
    "UPDATE users SET mfa_enabled=true,mfa_secret='verified-secret' WHERE id=$1",
    [uid],
  );
  assert.equal(
    (
      await call(`/saas/owner/users/${uid}/action`, {
        client: owner,
        method: "POST",
        body: { action: "RESET_MFA", reason: "Verified identity in support" },
      })
    ).status,
    200,
  );
  const user = await one(
    db,
    "SELECT mfa_enabled,mfa_secret FROM users WHERE id=$1",
    [uid],
  );
  assert.equal(user.mfa_enabled, false);
  assert.equal(user.mfa_secret, null);
  assert.equal((await call("/me", { client: school })).status, 401);
});

test("standalone owner optionally enables MFA without school configuration", async () => {
  process.env.REQUIRE_MFA = "true";
  try {
    owner = await login("owner@console.test", "/auth/owner/login");
    assert.equal(owner.user.mfa_setup_required, false);
    assert.equal((await call("/saas/owner", { client: owner })).status, 200);
    const setup = await call("/auth/mfa/setup", {
      client: owner,
      method: "POST",
      body: {},
    });
    assert.equal(setup.status, 200, JSON.stringify(setup));
    const totp = new OTPAuth.TOTP({
      issuer: "SMPIS",
      label: "owner@console.test",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.data.secret),
    });
    assert.equal(
      (
        await call("/auth/mfa/enable", {
          client: owner,
          method: "POST",
          body: { code: totp.generate() },
        })
      ).status,
      200,
    );
    assert.equal((await call("/saas/owner", { client: owner })).status, 200);
    await call("/auth/logout", { client: owner, method: "POST", body: {} });
    owner = await login("owner@console.test", "/auth/owner/login");
    assert.equal(owner.mfa_required, true);
    assert.equal((await call("/saas/owner", { client: owner })).status, 403);
    assert.equal(
      (
        await call("/auth/mfa/verify", {
          client: owner,
          method: "POST",
          body: { code: totp.generate() },
        })
      ).status,
      200,
    );
    assert.equal((await call("/saas/owner", { client: owner })).status, 200);
  } finally {
    process.env.REQUIRE_MFA = "false";
  }
});

test("owner edits credentials with password confirmation, session revocation and a secret-free audit", async () => {
  const other = await login("owner@console.test", "/auth/owner/login");
  const profile = {
    name: "Updated Owner",
    email: "updated-owner@console.test",
    current_password: password,
    new_password: "Updated-owner-password-2026!",
  };
  assert.equal(
    (
      await call("/saas/owner/profile", {
        client: owner,
        method: "PATCH",
        body: { ...profile, current_password: "incorrect" },
      })
    ).status,
    422,
  );
  const changed = await call("/saas/owner/profile", {
    client: owner,
    method: "PATCH",
    body: profile,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal((await call("/me", { client: other })).status, 401);
  const current = await call("/me", { client: owner });
  assert.equal(current.status, 200);
  assert.equal(current.data.user.name, profile.name);
  assert.equal(current.data.user.email, profile.email);
  const event = await one(
    db,
    "SELECT details::text AS details FROM subscription_events WHERE action='OWNER_PROFILE_UPDATED' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(event.details.includes(profile.current_password), false);
  assert.equal(event.details.includes(profile.new_password), false);
  assert.equal(
    (
      await call("/auth/owner/login", {
        method: "POST",
        body: { email: "owner@console.test", password },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/auth/owner/login", {
        method: "POST",
        body: { email: profile.email, password: profile.new_password },
      })
    ).status,
    200,
  );
  school = await login("admin@customer.test");
  assert.equal(
    (
      await call("/saas/owner/profile", {
        client: school,
        method: "PATCH",
        body: profile,
      })
    ).status,
    403,
  );
});

test("owner selects public pricing currency without exposing private billing settings", async () => {
  const config = (await call("/saas/owner", { client: owner })).data.settings;
  const fields = [
    "bank_name",
    "account_name",
    "account_number",
    "bank_currency",
    "bank_instructions",
    "grace_days",
    "bank_usd_rate",
  ];
  const original = Object.fromEntries(fields.map((key) => [key, config[key]]));
  const update = {
    ...original,
    landing_currency: "NGN",
    landing_usd_rate: 1500,
  };
  assert.equal(
    (
      await call("/saas/owner/settings", {
        client: owner,
        method: "PATCH",
        body: { ...update, landing_currency: "EUR" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call("/saas/owner/settings", {
        client: owner,
        method: "PATCH",
        body: { ...update, landing_usd_rate: 0 },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call("/saas/owner/settings", {
        client: owner,
        method: "PATCH",
        body: update,
      })
    ).status,
    200,
  );
  let plans = (await call("/saas/plans")).data;
  assert.equal(plans.display_currency, "NGN");
  assert.equal(plans.display_usd_rate, 1500);
  assert.equal(plans.currency, "NGN");
  assert.equal(plans.monthly_cents, 15000000);
  assert.equal(plans.yearly_cents, 153000000);
  assert.equal(plans.base_monthly_cents, 10000);
  assert.equal(plans.base_yearly_cents, 102000);
  assert.equal("account_number" in plans, false);
  assert.equal(
    (
      await call("/saas/owner/settings", {
        client: owner,
        method: "PATCH",
        body: original,
      })
    ).status,
    200,
  );
  assert.equal((await call("/saas/plans")).data.display_currency, "NGN");
  assert.equal(
    (
      await call("/saas/owner/settings", {
        client: owner,
        method: "PATCH",
        body: { ...update, landing_currency: "USD" },
      })
    ).status,
    200,
  );
  plans = (await call("/saas/plans")).data;
  assert.equal(plans.display_currency, "USD");
  assert.equal(plans.display_usd_rate, 1500);
});

test("global currency controls all new payment quotes and preserves earlier quotes after a switch", async () => {
  const settings = (await call("/saas/owner", { client: owner })).data.settings;
  const fields = [
    "bank_name",
    "account_name",
    "account_number",
    "bank_instructions",
    "grace_days",
  ];
  const bank = {
    ...Object.fromEntries(fields.map((k) => [k, settings[k]])),
    bank_name: "Test Bank",
    account_name: "SMPIS",
    account_number: "1234567890",
    landing_usd_rate: 1500,
  };
  for (const provider of ["stripe", "paystack", "flutterwave"]) {
    const r = await call("/saas/owner/providers/" + provider, {
      client: owner,
      method: "PATCH",
      body: {
        enabled: true,
        mode: "SANDBOX",
        secret_key:
          provider === "flutterwave" ? "FLWSECK-global_TEST" : "sk_test_global",
        webhook_secret: "test-webhook",
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r));
  }
  const originalFetch = globalThis.fetch;
  let stripeAmount,
    stripeCurrency,
    count = 0,
    ngnStripe;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.startsWith("https://api.stripe.com/")) {
      stripeAmount = Number(
        options.body.get("line_items[0][price_data][unit_amount]"),
      );
      stripeCurrency = options.body.get("line_items[0][price_data][currency]");
      return new Response(
        JSON.stringify({
          id: "cs_test_global_" + ++count,
          url: "https://checkout.stripe.com/c/pay/global",
        }),
        { status: 200 },
      );
    }
    if (address.startsWith("https://api.paystack.co/"))
      return new Response(
        JSON.stringify({
          status: true,
          data: { authorization_url: "https://checkout.paystack.com/global" },
        }),
        { status: 200 },
      );
    if (address.startsWith("https://api.flutterwave.com/"))
      return new Response(
        JSON.stringify({
          status: "success",
          data: { link: "https://checkout.flutterwave.com/global" },
        }),
        { status: 200 },
      );
    return originalFetch(url, options);
  };
  try {
    for (const currency of ["NGN", "USD"]) {
      assert.equal(
        (
          await call("/saas/owner/settings", {
            client: owner,
            method: "PATCH",
            body: { ...bank, landing_currency: currency },
          })
        ).status,
        200,
      );
      const expected = currency === "NGN" ? 153000000 : 102000;
      const payment = await call("/subscription/bank", {
        client: school,
        method: "POST",
        body: {
          billing_cycle: "YEARLY",
          transfer_reference: "GLOBAL-" + currency,
        },
      });
      assert.equal(payment.status, 201, JSON.stringify(payment));
      assert.equal(Number(payment.data.charge_amount_cents), expected);
      assert.equal(payment.data.charge_currency, currency);
      for (const provider of ["stripe", "paystack", "flutterwave"]) {
        const checkout = await call("/subscription/checkout", {
          client: school,
          method: "POST",
          body: { provider, billing_cycle: "YEARLY" },
        });
        assert.equal(checkout.status, 200, JSON.stringify(checkout));
        const record = await one(
          db,
          "SELECT * FROM subscription_payments WHERE provider=$1 ORDER BY id DESC LIMIT 1",
          [provider],
        );
        assert.equal(record.amount_cents, 102000);
        assert.equal(Number(record.charge_amount_cents), expected);
        assert.equal(record.charge_currency, currency);
        if (provider === "stripe") {
          assert.equal(stripeAmount, expected);
          assert.equal(stripeCurrency, currency.toLowerCase());
          if (currency === "NGN") ngnStripe = record;
        }
      }
    }
    const session = {
      id: ngnStripe.provider_id,
      client_reference_id: ngnStripe.reference,
      currency: "ngn",
      amount_total: Number(ngnStripe.charge_amount_cents),
      metadata: { school_id: String(ngnStripe.school_id) },
      payment_status: "paid",
      livemode: false,
    };
    assert.equal((await verifyCheckout(db, session)).status, "TEST_CONFIRMED");
    const historical = await one(
      db,
      "SELECT charge_currency,charge_amount_cents FROM subscription_payments WHERE id=$1",
      [ngnStripe.id],
    );
    assert.equal(historical.charge_currency, "NGN");
    assert.equal(Number(historical.charge_amount_cents), 153000000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
