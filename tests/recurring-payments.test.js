import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "./app.js";
import { insert, one } from "../server/db.js";
import {
  saveProvider,
  verifyAlternativePayment,
} from "../server/saas-providers.js";
import {
  autoRenewalSummary,
  saveRecurringMethod,
} from "../server/recurring-methods.js";
import { runAutoRenewals } from "../server/recurring-payments.js";
import { settleSubscriptionPayment } from "../server/saas-service.js";
import { renderEmail } from "../server/email-templates.js";
import { verifyCheckout } from "../server/saas-routes.js";
import { deliverNotifications } from "../server/jobs.js";
import nodemailer from "nodemailer";

test("automatic card renewals, retry boundaries, verification and consent", async (t) => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const db = await openTestDatabase();
  await createApp(db);
  let sequence = 0;
  const calls = [],
    intents = new Map();
  let outcome = "success",
    requestSchool = null;
  async function fixture(provider = "paystack", overrides = {}) {
    const code = `AUTO${++sequence}`;
    const school = await insert(db, "schools", {
      name: code,
      short_code: code,
      portal_slug: code.toLowerCase(),
    });
    const user = await insert(db, "users", {
      school_id: school.id,
      name: "Administrator",
      email: `${code}@auto.test`,
      role: "SUPER_ADMIN",
      password_hash: "unused",
    });
    const due = new Date(Date.now() - 3600000);
    await db.query(
      `INSERT INTO school_subscriptions(school_id,plan,status,period_end) VALUES($1,'PRO','ACTIVE',$2)
      ON CONFLICT(school_id) DO UPDATE SET plan='PRO',status='ACTIVE',period_end=$2`,
      [school.id, due],
    );
    const payment = await insert(db, "subscription_payments", {
      school_id: school.id,
      reference: code,
      billing_cycle: "MONTHLY",
      amount_cents: 10000,
      method: "CARD",
      provider,
      mode: "LIVE",
      status: "PAID",
      initiated_by: user.id,
      charge_amount_cents: 10000,
      charge_currency: "USD",
      auto_renew_requested: true,
      ...overrides,
    });
    const method =
      provider === "stripe"
        ? { customer: "cus_saved", payment_method: "pm_saved" }
        : provider === "paystack"
          ? { authorization_code: "AUTH_saved" }
          : { token: "flw_saved" };
    await saveRecurringMethod(db, payment, method, {
      brand: "Visa",
      last4: "4242",
    });
    requestSchool = school.id;
    return { school, user, due, payment, method };
  }
  async function automatic(reference) {
    return one(db, "SELECT * FROM subscription_payments WHERE reference=$1", [
      reference,
    ]);
  }
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input),
      path = url.pathname;
    const body = options.body
      ? url.hostname === "api.stripe.com"
        ? Object.fromEntries(new URLSearchParams(options.body))
        : JSON.parse(options.body)
      : null;
    calls.push({ path, body, key: options.headers?.["Idempotency-Key"] });
    let data;
    if (url.hostname === "api.stripe.com") {
      if (path === "/v1/payment_intents") {
        assert.ok(!body.confirm, "Persist intent before allowing a charge");
        const id = "pi_" + body["metadata[reference]"];
        data = {
          id,
          status: "requires_confirmation",
          livemode: true,
          currency: body.currency,
          amount: Number(body.amount),
          amount_received: 0,
          customer: body.customer,
          payment_method: body.payment_method,
          metadata: { reference: body["metadata[reference]"] },
        };
        intents.set(id, data);
      } else {
        const id = path.split("/")[3];
        data = intents.get(id);
        if (path.endsWith("/confirm")) {
          const p = await automatic(data.metadata.reference);
          assert.equal(
            p.provider_id,
            id,
            "Provider ID is durable before confirmation",
          );
          data.status = "succeeded";
          data.amount_received = data.amount;
        }
      }
      return new Response(JSON.stringify(data), { status: 200 });
    }
    if (
      path.endsWith("charge_authorization") ||
      path.endsWith("tokenized-charges")
    ) {
      assert.ok(
        body.authorization_code === "AUTH_saved" || body.token === "flw_saved",
      );
      if (outcome === "timeout")
        throw new Error("Lost response after bank accepted charge");
      const p = await automatic(body.reference || body.tx_ref);
      data = {
        id: p.id + 1000,
        status:
          outcome === "decline"
            ? "failed"
            : url.hostname === "api.paystack.co"
              ? "success"
              : "successful",
      };
    } else {
      const p = path.includes("verify_by_reference")
        ? await automatic(url.searchParams.get("tx_ref"))
        : path.startsWith("/transaction/verify/")
          ? await automatic(decodeURIComponent(path.split("/").at(-1)))
          : await one(
              db,
              "SELECT * FROM subscription_payments WHERE school_id=$1 AND ($2::boolean OR automatic) ORDER BY id DESC LIMIT 1",
              [requestSchool, outcome === "capture"],
            );
      data = {
        id: p.id + 1000,
        status: p.provider === "paystack" ? "success" : "successful",
        reference: p.reference,
        tx_ref: p.reference,
        amount:
          p.provider === "paystack"
            ? Number(p.charge_amount_cents)
            : Number(p.charge_amount_cents) / 100,
        currency: outcome === "mismatch" ? "NGN" : p.charge_currency,
        domain: "live",
      };
      if (outcome === "capture") {
        data.authorization = {
          reusable: true,
          channel: "card",
          authorization_code: "AUTH_verified",
          card_type: "Visa",
          last4: "1234",
        };
        data.card = {
          token: "flw_verified",
          type: "Visa",
          last_4digits: "1234",
        };
        data.customer = { email: "verified@auto.test" };
      }
    }
    return new Response(JSON.stringify({ status: true, data }), {
      status: 200,
    });
  });
  try {
    await db.query("UPDATE saas_settings SET grace_days=3 WHERE id=1");
    for (const provider of ["stripe", "paystack", "flutterwave"])
      await saveProvider(db, provider, {
        enabled: true,
        mode: "LIVE",
        secret_key:
          provider === "flutterwave" ? "FLWSECK-live" : "sk_live_saved",
        webhook_secret: "webhook_secret",
      });
    await t.test(
      "all three providers renew once, despite overlapping workers",
      async () => {
        for (const provider of ["stripe", "paystack", "flutterwave"]) {
          const { school, due } = await fixture(provider);
          const stored = await one(
            db,
            "SELECT encrypted_method FROM subscription_auto_renewals WHERE school_id=$1",
            [school.id],
          );
          assert.ok(!stored.encrypted_method.includes("saved"));
          assert.ok(
            !JSON.stringify(await autoRenewalSummary(db, school.id)).includes(
              "encrypted_method",
            ),
          );
          const initialCalls = calls.length;
          await Promise.all([runAutoRenewals(db), runAutoRenewals(db)]);
          const payments = (
            await db.query(
              "SELECT * FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).rows;
          assert.equal(payments.length, 1);
          assert.equal(payments[0].status, "PAID");
          assert.ok(
            new Date(
              (
                await one(
                  db,
                  "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
                  [school.id],
                )
              ).period_end,
            ) > due,
          );
          await runAutoRenewals(db);
          assert.equal(
            calls
              .slice(initialCalls)
              .filter(
                (c) =>
                  c.path.endsWith("charge_authorization") ||
                  c.path.endsWith("tokenized-charges") ||
                  c.path.endsWith("/confirm"),
              ).length,
            1,
          );
        }
      },
    );
    await t.test(
      "initial verified payments capture only explicitly authorized reusable cards",
      async () => {
        outcome = "capture";
        for (const provider of ["paystack", "flutterwave"]) {
          const { school, payment } = await fixture(provider, {
            status: "PENDING",
          });
          assert.ok(!(await autoRenewalSummary(db, school.id)));
          const paid = await verifyAlternativePayment(
            db,
            provider,
            provider === "paystack" ? payment.reference : payment.id,
            school.id,
          );
          assert.equal(paid.status, "PAID");
          assert.equal(
            (await autoRenewalSummary(db, school.id)).card_last4,
            "1234",
          );
        }
        const { school, payment } = await fixture("stripe", {
          status: "PENDING",
          provider_id: "cs_capture",
        });
        intents.set("pi_capture", {
          status: "succeeded",
          livemode: true,
          amount_received: 10000,
          currency: "usd",
          customer: "cus_capture",
          payment_method: {
            type: "card",
            id: "pm_capture",
            card: { brand: "visa", last4: "5678" },
          },
        });
        await verifyCheckout(db, {
          id: "cs_capture",
          client_reference_id: payment.reference,
          metadata: { school_id: String(school.id) },
          currency: "usd",
          amount_total: 10000,
          payment_status: "paid",
          livemode: true,
          customer: "cus_capture",
          payment_intent: "pi_capture",
        });
        assert.equal(
          (await autoRenewalSummary(db, school.id)).card_last4,
          "5678",
        );
        outcome = "success";
      },
    );
    await t.test(
      "declines wait 12h, notify once per attempt and stop after grace",
      async () => {
        outcome = "decline";
        const { school } = await fixture();
        await runAutoRenewals(db);
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).n,
          1,
        );
        const renewal = await one(
          db,
          "SELECT * FROM subscription_auto_renewals WHERE school_id=$1",
          [school.id],
        );
        assert.ok(
          new Date(renewal.next_attempt_at).getTime() >
            Date.now() + 11 * 3600000,
        );
        await db.query(
          "UPDATE subscription_auto_renewals SET next_attempt_at=now()-interval '1 minute' WHERE school_id=$1",
          [school.id],
        );
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).n,
          2,
        );
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM notifications WHERE school_id=$1 AND dedupe_key LIKE 'auto-renewal-issue:%'",
              [school.id],
            )
          ).n,
          2,
        );
        await db.query(
          "UPDATE school_subscriptions SET period_end=now()-interval '4 days' WHERE school_id=$1",
          [school.id],
        );
        await db.query(
          "UPDATE subscription_auto_renewals SET next_attempt_at=now()-interval '1 minute' WHERE school_id=$1",
          [school.id],
        );
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).n,
          2,
        );
      },
    );
    await t.test(
      "ambiguous timeout reconciles the original payment without another debit",
      async () => {
        outcome = "timeout";
        const { school } = await fixture();
        const initialCalls = calls.length;
        await runAutoRenewals(db);
        assert.ok((await autoRenewalSummary(db, school.id)).payment_pending);
        outcome = "success";
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT status FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).status,
          "PAID",
        );
        assert.equal(
          calls
            .slice(initialCalls)
            .filter((c) => c.path.endsWith("charge_authorization")).length,
          1,
        );
      },
    );
    await t.test(
      "no consent, test payments and revocations cannot enable debits",
      async () => {
        for (const overrides of [
          { auto_renew_requested: false },
          { mode: "SANDBOX" },
        ]) {
          const { school } = await fixture("paystack", overrides);
          assert.ok(!(await autoRenewalSummary(db, school.id)));
        }
        const { school, payment, method } = await fixture();
        await db.query(
          "UPDATE subscription_auto_renewals SET enabled=false,revoked_at=now() WHERE school_id=$1",
          [school.id],
        );
        await saveRecurringMethod(db, payment, method);
        assert.equal((await autoRenewalSummary(db, school.id)).enabled, false);
        const before = calls.length;
        await runAutoRenewals(db);
        assert.equal(calls.length, before);
      },
    );
    await t.test(
      "mismatched verification remains pending and does not extend access",
      async () => {
        const { school, due } = await fixture();
        outcome = "mismatch";
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
              [school.id],
            )
          ).period_end.getTime(),
          due.getTime(),
        );
        assert.equal(
          (
            await one(
              db,
              "SELECT status FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).status,
          "PENDING",
        );
        outcome = "success";
        await runAutoRenewals(db);
      },
    );
    await t.test(
      "stale automatic success is held for review after a separate renewal",
      async () => {
        const { school, user, due } = await fixture();
        const p = await insert(db, "subscription_payments", {
          school_id: school.id,
          reference: "STALE",
          billing_cycle: "MONTHLY",
          amount_cents: 10000,
          method: "CARD",
          provider: "paystack",
          mode: "LIVE",
          initiated_by: user.id,
          automatic: true,
          renewal_due_at: due,
        });
        await db.query(
          "UPDATE school_subscriptions SET period_end=now()+interval '1 month' WHERE school_id=$1",
          [school.id],
        );
        assert.equal(
          (await settleSubscriptionPayment(db, p.id)).status,
          "REVIEW",
        );
      },
    );
    await t.test(
      "zero grace allows one initial attempt; suspended/deleted schools are never charged",
      async () => {
        await db.query("UPDATE saas_settings SET grace_days=0 WHERE id=1");
        outcome = "decline";
        const { school } = await fixture();
        await runAutoRenewals(db);
        await db.query(
          "UPDATE subscription_auto_renewals SET next_attempt_at=now()-interval '1 hour' WHERE school_id=$1",
          [school.id],
        );
        await runAutoRenewals(db);
        assert.equal(
          (
            await one(
              db,
              "SELECT count(*)::int AS n FROM subscription_payments WHERE school_id=$1 AND automatic",
              [school.id],
            )
          ).n,
          1,
        );
        await db.query("UPDATE saas_settings SET grace_days=3 WHERE id=1");
        for (const status of ["SUSPENDED", "TERMINATED", "DELETE"]) {
          const { school } = await fixture();
          if (status === "DELETE")
            await db.query(
              "UPDATE school_subscriptions SET deletion_requested_at=now() WHERE school_id=$1",
              [school.id],
            );
          else
            await db.query(
              "UPDATE school_subscriptions SET status=$2,suspension_reason='MANUAL' WHERE school_id=$1",
              [school.id, status],
            );
          await runAutoRenewals(db);
          assert.equal(
            (
              await one(
                db,
                "SELECT count(*)::int AS n FROM subscription_payments WHERE school_id=$1 AND automatic",
                [school.id],
              )
            ).n,
            0,
          );
        }
        outcome = "success";
      },
    );
    await t.test(
      "gentle failure emails use owner-edited branded HTML",
      async () => {
        await db.query(
          "INSERT INTO platform_email_templates(key,subject,body) VALUES('auto_renewal_failed','A little billing help','Hello, we could not renew. {{body}} Open {{link}}')",
        );
        const email = await renderEmail(db, "auto_renewal_failed", {
          body: "Please pay to continue using SMPIS.",
          link: "https://smpis.test/school/#subscription",
        });
        assert.equal(email.subject, "A little billing help");
        assert.ok(email.html.includes("Review your subscription"));
        assert.ok(email.html.includes("Please pay to continue"));
        assert.ok(email.text.includes("Please pay to continue"));
        const messages = [];
        t.mock.method(nodemailer, "createTransport", () => ({
          sendMail: async (message) => messages.push(message),
        }));
        const previousUrl = process.env.APP_URL;
        process.env.APP_URL = "https://smpis.test";
        try {
          await deliverNotifications(db, {
            configuration: async () => ({
              transport: {},
              from: "billing@smpis.test",
            }),
          });
          assert.ok(messages.length > 0);
          assert.ok(
            messages.every(
              (message) => message.subject === "A little billing help",
            ),
          );
          assert.ok(
            messages.every(
              (message) =>
                message.html.includes("#subscription") &&
                message.html.includes("Review your subscription"),
            ),
          );
        } finally {
          if (previousUrl === undefined) delete process.env.APP_URL;
          else process.env.APP_URL = previousUrl;
        }
      },
    );
  } finally {
    await db.close();
  }
});
