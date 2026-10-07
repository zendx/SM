import { platformTeamRoutes } from "./platform-team-routes.js";
import { accountLifecycleRoutes } from "./account-lifecycle-routes.js";
import { requireSubscriptions } from "./platform-access.js";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { PostgresRateLimitStore } from "./rate-limit-store.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z, text } from "./validation.js";
import { one, rows, insert } from "./db.js";
import { fail, token } from "./security.js";
import {
  ownerMetrics,
  ownerActivity,
  ownerSupportRoutes,
} from "./owner-service.js";
import { siteOrigin } from "./seo.js";
import {
  registerSchool,
  portalSlug,
  price,
  settings,
  subscriptionSnapshot,
  subscriptionEvent,
  settleSubscriptionPayment,
  expireSubscriptions,
} from "./saas-service.js";
import {
  providerNames,
  providerConfig,
  providerSummaries,
  saveProvider,
  chargeQuote,
  providerRequest,
  equalSecret,
  verifyPaystackSignature,
  verifyAlternativePayment,
} from "./saas-providers.js";

const cycleSchema = z.object({ billing_cycle: z.enum(["MONTHLY", "YEARLY"]) });
function schoolAdmin(req, res, next) {
  if (req.user.role !== "SUPER_ADMIN")
    fail(403, "Only the school administrator can manage this subscription.");
  next();
}
function owner(req, res, next) {
  if (!req.user.platform_operator) fail(403, "SMPIS owner access required.");
  next();
}
async function payable(db, schoolId) {
  const sub = await one(
    db,
    "SELECT * FROM school_subscriptions WHERE school_id=$1",
    [schoolId],
  );
  if (
    !sub ||
    sub.status === "TERMINATED" ||
    (sub.status === "SUSPENDED" &&
      !["TRIAL_EXPIRED", "OVERDUE"].includes(sub.suspension_reason))
  )
    fail(
      403,
      "Contact the SMPIS owner before making a payment for this portal.",
    );
}
export async function stripeRequest(path, body, idempotencyKey) {
  const key = process.env.SAAS_STRIPE_SECRET_KEY;
  if (!/^sk_(test|live)_/.test(key || ""))
    fail(
      503,
      "Card checkout is not configured. Choose bank transfer or contact the SMPIS owner.",
    );
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok)
    fail(
      502,
      "The card provider could not process this request. Please retry or contact the SMPIS owner.",
    );
  return payload;
}
export function verifyStripeSignature(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || !secret || !header) return false;
  const fields = header.split(",").map((x) => x.trim().split("="));
  const timestamp = fields.find(([k]) => k === "t")?.[1];
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest();
  return fields
    .filter(([k]) => k === "v1")
    .some(
      ([, v]) =>
        /^[a-f0-9]{64}$/i.test(v || "") &&
        timingSafeEqual(expected, Buffer.from(v, "hex")),
    );
}
export async function verifyCheckout(db, session) {
  const p = await one(
    db,
    "SELECT * FROM subscription_payments WHERE reference=$1 AND method='CARD'",
    [String(session.client_reference_id || "")],
  );
  if (!p) fail(404, "Subscription payment not found.");
  if (
    p.provider !== "stripe" ||
    p.provider_id !== session.id ||
    session.currency !== (p.charge_currency || "USD").toLowerCase() ||
    session.amount_total !== Number(p.charge_amount_cents || p.amount_cents) ||
    session.metadata?.school_id !== String(p.school_id)
  )
    fail(422, "Card verification does not match the recorded payment.");
  if (session.payment_status !== "paid") return p;
  const c = await providerConfig(db, "stripe");
  if (
    c.mode !== p.mode ||
    typeof session.livemode !== "boolean" ||
    session.livemode !== (p.mode === "LIVE")
  )
    fail(422, "Payment mode does not match configuration.");
  return settleSubscriptionPayment(db, p.id, null, {
    testMode: !session.livemode,
  });
}
export function subscriptionWebhook(db) {
  return async (req, res) => {
    const c = await providerConfig(db, "stripe");
    if (
      !verifyStripeSignature(
        req.body,
        req.get("stripe-signature"),
        c.webhook_secret,
      )
    )
      fail(400, "Invalid card webhook signature.");
    const event = JSON.parse(req.body.toString("utf8"));
    if (
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type)
    ) {
      // Retrieve from Stripe as well as verifying the signed delivery.
      const session = await providerRequest(
        "stripe",
        c,
        `/checkout/sessions/${encodeURIComponent(event.data.object.id)}`,
      );
      await verifyCheckout(db, session);
    }
    res.json({ received: true });
  };
}
export function alternativeWebhook(db, provider) {
  return async (req, res) => {
    const c = await providerConfig(db, provider);
    const valid =
      provider === "paystack"
        ? verifyPaystackSignature(
            req.body,
            req.get("x-paystack-signature"),
            c.secret_key,
          )
        : equalSecret(req.get("verif-hash"), c.webhook_secret);
    if (!valid || !c.enabled) fail(400, "Invalid payment webhook signature.");
    const event = JSON.parse(req.body.toString("utf8"));
    if (provider === "paystack" && event.event === "charge.success")
      await verifyAlternativePayment(db, provider, event.data.reference);
    if (provider === "flutterwave" && event.event === "charge.completed")
      await verifyAlternativePayment(db, provider, event.data.id);
    res.json({ received: true });
  };
}
export function saasPublicRoutes(db) {
  const r = express.Router();
  r.get("/saas/plans", async (req, res) => {
    const config = await settings(db);
    res.json({
      data: {
        trial_days: 30,
        monthly_cents: chargeQuote(price("MONTHLY", config), {
          currency: config.landing_currency,
          usd_rate: config.landing_usd_rate,
        }).charge_amount_cents,
        yearly_cents: chargeQuote(price("YEARLY", config), {
          currency: config.landing_currency,
          usd_rate: config.landing_usd_rate,
        }).charge_amount_cents,
        currency: config.landing_currency,
        base_currency: "USD",
        base_monthly_cents: price("MONTHLY", config),
        base_yearly_cents: price("YEARLY", config),
        display_currency: config.landing_currency,
        display_usd_rate: Number(config.landing_usd_rate),
        registration_open: !!(await one(
          db,
          "SELECT user_id FROM platform_operators LIMIT 1",
        )),
      },
    });
  });
  r.get("/saas/portal/:slug", async (req, res) => {
    const slug = portalSlug.parse(req.params.slug);
    const school = await one(
      db,
      "SELECT name,portal_slug FROM schools WHERE portal_slug=$1",
      [slug],
    );
    if (!school)
      fail(
        404,
        "This school portal does not exist. Check the address or create a school account.",
      );
    res.json({ data: school });
  });
  r.post(
    "/saas/register",
    rateLimit({
      windowMs: 3600000,
      limit: 8,
      store: new PostgresRateLimitStore(db, "saas-registration"),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) =>
      res.status(201).json({ data: await registerSchool(db, req.body) }),
  );
  return r;
}
export function saasRoutes(db) {
  const r = express.Router();
  r.use(platformTeamRoutes(db));
  r.use(accountLifecycleRoutes(db));
  r.use(ownerSupportRoutes(db));
  r.get("/subscription", async (req, res) =>
    res.json({
      data: {
        ...(await subscriptionSnapshot(db, req.user.school_id)),
        ...(req.user.role === "SUPER_ADMIN" ? {} : { payments: [] }),
      },
    }),
  );
  r.post("/subscription/bank", schoolAdmin, async (req, res) => {
    const b = cycleSchema
      .extend({
        transfer_reference: text.max(200),
        note: z.string().trim().max(2000).default(""),
      })
      .parse(req.body);
    await payable(db, req.user.school_id);
    const config = await settings(db);
    if (!config.bank_name || !config.account_name || !config.account_number)
      fail(503, "The SMPIS owner has not published bank-transfer details yet.");
    const payment = await db.transaction(async (tx) => {
      const p = await insert(tx, "subscription_payments", {
        school_id: req.user.school_id,
        initiated_by: req.user.id,
        reference: "SMPIS-" + token().slice(0, 20),
        billing_cycle: b.billing_cycle,
        amount_cents: price(b.billing_cycle, config),
        method: "BANK",
        mode: "LIVE",
        ...chargeQuote(price(b.billing_cycle, config), {
          currency: config.landing_currency,
          usd_rate: config.landing_usd_rate,
        }),
        transfer_reference: b.transfer_reference,
        note: b.note,
      });
      await subscriptionEvent(
        tx,
        req.user.school_id,
        req.user.id,
        "BANK_PAYMENT_SUBMITTED",
        { payment_id: p.id, reference: p.reference },
      );
      return p;
    });
    res.status(201).json({ data: payment });
  });
  r.post("/subscription/checkout", schoolAdmin, async (req, res) => {
    const b = cycleSchema
      .extend({ provider: z.enum(providerNames).default("stripe") })
      .parse(req.body);
    await payable(db, req.user.school_id);
    const c = await providerConfig(db, b.provider);
    const config = await settings(db);
    if (!c.enabled || !c.secret_key)
      fail(503, "This card provider is not configured.");
    const school = await one(
      db,
      "SELECT portal_slug FROM schools WHERE id=$1",
      [req.user.school_id],
    );
    const p = await insert(db, "subscription_payments", {
      school_id: req.user.school_id,
      initiated_by: req.user.id,
      reference: "SMPIS-" + token().slice(0, 20),
      billing_cycle: b.billing_cycle,
      amount_cents: price(b.billing_cycle, config),
      method: "CARD",
      provider: b.provider,
      mode: c.mode,
      ...chargeQuote(price(b.billing_cycle, config), {
        currency: config.landing_currency,
        usd_rate: config.landing_usd_rate,
      }),
    });
    const returnUrl = `${siteOrigin()}/${school.portal_slug}/?subscription_provider=${b.provider}#subscription`;
    if (b.provider !== "stripe") {
      const body =
        b.provider === "paystack"
          ? {
              email: req.user.email,
              amount: p.charge_amount_cents,
              currency: p.charge_currency,
              reference: p.reference,
              callback_url: returnUrl,
              channels: ["card"],
            }
          : {
              tx_ref: p.reference,
              amount: p.charge_amount_cents / 100,
              currency: p.charge_currency,
              redirect_url: returnUrl,
              payment_options: "card",
              customer: { email: req.user.email, name: req.user.name },
              customizations: { title: "SMPIS Pro" },
            };
      const result = await providerRequest(
        b.provider,
        c,
        b.provider === "paystack" ? "/transaction/initialize" : "/payments",
        body,
      );
      const url =
        b.provider === "paystack" ? result.authorization_url : result.link;
      const hosts =
        b.provider === "paystack"
          ? ["checkout.paystack.com"]
          : ["checkout.flutterwave.com"];
      if (
        !url ||
        !hosts.includes(new URL(url).hostname) ||
        new URL(url).protocol !== "https:"
      )
        fail(502, "Invalid payment checkout address.");
      return res.json({ data: { url } });
    }
    const callback = `${siteOrigin()}/${school.portal_slug}/?checkout_session={CHECKOUT_SESSION_ID}#subscription`;
    const session = await providerRequest(
      "stripe",
      c,
      "/checkout/sessions",
      {
        mode: "payment",
        success_url: callback,
        cancel_url: `${siteOrigin()}/${school.portal_slug}/#subscription`,
        customer_email: req.user.email,
        client_reference_id: p.reference,
        "metadata[school_id]": String(p.school_id),
        "payment_method_types[0]": "card",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": p.charge_currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(p.charge_amount_cents),
        "line_items[0][price_data][product_data][name]": `SMPIS Pro — ${b.billing_cycle === "YEARLY" ? "one year" : "one month"}`,
      },
      p.reference,
    );
    if (!session.id || !session.url?.startsWith("https://checkout.stripe.com/"))
      fail(502, "Invalid checkout response.");
    await db.query(
      "UPDATE subscription_payments SET provider_id=$2 WHERE id=$1",
      [p.id, session.id],
    );
    res.json({ data: { url: session.url } });
  });
  r.post("/subscription/verify", schoolAdmin, async (req, res) => {
    const b = z
      .object({
        provider: z.enum(providerNames).default("stripe"),
        session_id: z.string().max(200).optional(),
        reference: z.string().max(200).optional(),
        transaction_id: z.string().regex(/^\d+$/).optional(),
      })
      .parse(req.body);
    if (b.provider !== "stripe") {
      const identifier =
        b.provider === "paystack" ? b.reference : b.transaction_id;
      if (!identifier) fail(422, "Missing payment reference.");
      return res.json({
        data: await verifyAlternativePayment(
          db,
          b.provider,
          identifier,
          req.user.school_id,
        ),
      });
    }
    const session_id = z
      .string()
      .regex(/^cs_(test|live)_[A-Za-z0-9]+$/)
      .parse(b.session_id);
    const p = await one(
      db,
      "SELECT id FROM subscription_payments WHERE school_id=$1 AND provider_id=$2",
      [req.user.school_id, session_id],
    );
    if (!p) fail(404, "Payment not found for this school.");
    res.json({
      data: await verifyCheckout(
        db,
        await providerRequest(
          "stripe",
          await providerConfig(db, "stripe"),
          `/checkout/sessions/${encodeURIComponent(session_id)}`,
        ),
      ),
    });
  });
  r.use("/saas/owner", (req, res, next) => {
    if (/^\/tenants\/\d+$/.test(req.path) && req.method === "PATCH")
      return requireSubscriptions(req, res, next);
    return owner(req, res, next);
  });
  r.get("/saas/owner/export", async (req, res) => {
    const kind = z
      .enum(["payments", "audit"])
      .parse(req.query.kind || "payments");
    const records =
      kind === "payments"
        ? await rows(
            db,
            `SELECT s.name AS school,p.reference,p.billing_cycle,p.amount_cents AS usd_cents,
      p.charge_currency,p.charge_amount_cents,p.method,p.provider,p.mode,p.status,p.transfer_reference,p.note,p.created_at,p.paid_at
      FROM subscription_payments p JOIN schools s ON s.id=p.school_id ORDER BY p.created_at DESC`,
          )
        : await rows(
            db,
            "SELECT s.name AS school,e.action,u.name AS actor,e.details,e.created_at FROM subscription_events e LEFT JOIN schools s ON s.id=e.school_id LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC",
          );
    const keys =
      kind === "payments"
        ? [
            "school",
            "reference",
            "billing_cycle",
            "usd_cents",
            "charge_currency",
            "charge_amount_cents",
            "method",
            "provider",
            "mode",
            "status",
            "transfer_reference",
            "note",
            "created_at",
            "paid_at",
          ]
        : ["school", "action", "actor", "details", "created_at"];
    const cell = (value) => {
      let str =
        value instanceof Date
          ? value.toISOString()
          : typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value ?? "");
      if (/^[\s]*[=+@-]/.test(str)) str = "'" + str;
      return '"' + str.replaceAll('"', '""') + '"';
    };
    const csv = [
      keys.map(cell).join(","),
      ...records.map((row) => keys.map((k) => cell(row[k])).join(",")),
    ].join("\r\n");
    res
      .set("Content-Disposition", `attachment; filename="smpis-${kind}.csv"`)
      .type("text/csv")
      .send("\uFEFF" + csv);
  });
  r.get("/saas/owner", async (req, res) => {
    await expireSubscriptions(db);
    const tenants = await rows(
      db,
      `SELECT c.id,c.name,c.portal_slug,c.created_at,s.*,
      (SELECT count(*)::int FROM students st WHERE st.school_id=c.id AND st.status='ENROLLED') AS students,
      (SELECT COALESCE(sum(p.amount_cents),0)::bigint FROM subscription_payments p WHERE p.school_id=c.id AND p.status IN ('PAID','REVIEW')) AS received_cents,
      EXISTS(SELECT 1 FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=c.id) AS owner_school
      FROM schools c JOIN school_subscriptions s ON s.school_id=c.id ORDER BY c.created_at DESC`,
    );
    const payments = await rows(
      db,
      "SELECT p.*,s.name AS school_name FROM subscription_payments p JOIN schools s ON s.id=p.school_id ORDER BY p.created_at DESC LIMIT 250",
    );
    const revenue = await one(
      db,
      `SELECT COALESCE(sum(amount_cents) FILTER(WHERE status IN ('PAID','REVIEW')),0)::bigint AS received_cents,
      COALESCE(sum(amount_cents) FILTER(WHERE status IN ('PAID','REVIEW') AND paid_at>=date_trunc('month',now())),0)::bigint AS month_cents,
      COALESCE(sum(amount_cents) FILTER(WHERE status='PENDING' AND method='BANK'),0)::bigint AS pending_bank_cents FROM subscription_payments`,
    );
    const monthly = await rows(
      db,
      "SELECT to_char(date_trunc('month',paid_at),'YYYY-MM') AS month,sum(amount_cents)::bigint AS received_cents FROM subscription_payments WHERE status IN ('PAID','REVIEW') GROUP BY date_trunc('month',paid_at) ORDER BY month DESC LIMIT 24",
    );
    const events = await rows(
      db,
      "SELECT e.*,s.name AS school_name,u.name AS actor_name FROM subscription_events e LEFT JOIN schools s ON s.id=e.school_id LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC LIMIT 250",
    );
    res.json({
      data: {
        tenants,
        payments,
        revenue,
        monthly,
        events,
        settings: await settings(db),
        providers: await providerSummaries(db),
        metrics: await ownerMetrics(db),
        activity: await ownerActivity(db),
      },
    });
  });
  r.patch("/saas/owner/providers/:provider", async (req, res) => {
    const provider = z.enum(providerNames).parse(req.params.provider);
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM saas_settings WHERE id=1 FOR UPDATE");
      const saved = await saveProvider(tx, provider, req.body);
      await subscriptionEvent(
        tx,
        req.user.school_id,
        req.user.id,
        "PAYMENT_PROVIDER_UPDATED",
        { provider, ...saved },
      );
      return saved;
    });
    res.json({ data: result });
  });
  r.post("/saas/owner/tenants", async (req, res) =>
    res
      .status(201)
      .json({ data: await registerSchool(db, req.body, req.user) }),
  );
  r.patch("/saas/owner/settings", async (req, res) => {
    const b = z
      .object({
        bank_name: z.string().trim().max(200),
        account_name: z.string().trim().max(200),
        account_number: z.string().trim().max(100),
        bank_currency: z.enum(["USD", "NGN"]).optional(),
        bank_instructions: z.string().trim().max(2000),
        grace_days: z.coerce.number().int().min(0).max(30),
        bank_usd_rate: z.coerce.number().positive().max(1000000).default(1),
        monthly_price_cents: z.coerce
          .number()
          .int()
          .min(1)
          .max(100000000)
          .optional(),
        landing_currency: z.enum(["USD", "NGN"]).optional(),
        landing_usd_rate: z.coerce.number().positive().max(1000000).optional(),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const current = await one(
        tx,
        "SELECT * FROM saas_settings WHERE id=1 FOR UPDATE",
      );
      const globalCurrency = b.landing_currency ?? current.landing_currency;
      const globalRate = b.landing_usd_rate ?? current.landing_usd_rate;
      await tx.query(
        "UPDATE saas_settings SET bank_name=$1,account_name=$2,account_number=$3,bank_currency=$4,bank_instructions=$5,grace_days=$6,bank_usd_rate=$7,landing_currency=COALESCE($8,landing_currency),landing_usd_rate=COALESCE($9,landing_usd_rate),updated_at=now() WHERE id=1",
        [
          b.bank_name,
          b.account_name,
          b.account_number,
          globalCurrency,
          b.bank_instructions,
          b.grace_days,
          globalCurrency === "USD" ? 1 : globalRate,
          b.landing_currency ?? null,
          b.landing_usd_rate ?? null,
        ],
      );
      await tx.query(
        "UPDATE saas_settings SET monthly_price_cents=COALESCE($1,monthly_price_cents),yearly_price_cents=round(COALESCE($1,monthly_price_cents)::numeric * 10.2)::int WHERE id=1",
        [b.monthly_price_cents ?? null],
      );
      await subscriptionEvent(
        tx,
        req.user.school_id,
        req.user.id,
        "BILLING_SETTINGS_UPDATED",
        b,
      );
    });
    res.json({ data: await settings(db) });
  });
  r.patch("/saas/owner/tenants/:school", async (req, res) => {
    const school = z.coerce.number().int().positive().parse(req.params.school);
    const b = z
      .object({
        action: z.enum(["SUSPEND", "RESTORE", "TERMINATE"]),
        reason: text.max(1000),
        access_until: z.iso.datetime().optional(),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      if (
        await one(
          tx,
          "SELECT o.user_id FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=$1",
          [school],
        )
      )
        fail(422, "The owner workspace cannot be suspended or terminated.");
      const sub = await one(
        tx,
        "SELECT * FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
        [school],
      );
      if (!sub) fail(404, "School not found.");
      if (sub.deletion_requested_at || sub.closed_at)
        fail(
          422,
          "Use owner account reactivation to restore a school that requested deletion.",
        );
      if (sub.status === "TERMINATED" && b.action !== "TERMINATE")
        fail(
          422,
          "A terminated subscription cannot be restored. Create a new subscription through an explicit recovery process.",
        );
      const end = b.access_until
        ? new Date(b.access_until)
        : new Date(sub.period_end);
      if (
        b.action === "RESTORE" &&
        sub.plan === "FREE" &&
        end > new Date(sub.trial_ends_at)
      )
        fail(
          422,
          "Free trials cannot extend beyond their original 30 days. Activate Pro through a verified payment.",
        );
      const expiredTrial =
        b.action === "RESTORE" && sub.plan === "FREE" && end <= new Date();
      if (b.action === "RESTORE" && sub.plan !== "FREE" && end <= new Date())
        fail(
          422,
          "Set a future access expiry to restore an expired subscription.",
        );
      await tx.query(
        "UPDATE school_subscriptions SET status=$2,suspension_reason=$3,period_end=$4,updated_at=now() WHERE school_id=$1",
        [
          school,
          b.action === "SUSPEND"
            ? "SUSPENDED"
            : b.action === "TERMINATE"
              ? "TERMINATED"
              : expiredTrial
                ? "SUSPENDED"
                : sub.plan === "FREE"
                  ? "TRIAL"
                  : "ACTIVE",
          b.action === "SUSPEND"
            ? "MANUAL"
            : expiredTrial
              ? "TRIAL_EXPIRED"
              : "",
          b.action === "RESTORE" ? end : sub.period_end,
        ],
      );
      await subscriptionEvent(tx, school, req.user.id, b.action, {
        reason: b.reason,
        access_until: b.action === "RESTORE" ? end : null,
        previous_status: sub.status,
      });
    });
    res.json({ data: { message: "Subscription updated." } });
  });
  r.post("/saas/owner/payments/:payment/review", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.payment);
    const b = z
      .object({ decision: z.enum(["APPROVE", "REJECT"]), note: text.max(1000) })
      .parse(req.body);
    const p = await one(
      db,
      "SELECT * FROM subscription_payments WHERE id=$1 AND method='BANK'",
      [id],
    );
    if (!p) fail(404, "Bank payment not found.");
    if (p.status !== "PENDING")
      fail(409, "This payment has already been reviewed.");
    if (b.decision === "APPROVE") {
      const result = await settleSubscriptionPayment(db, p.id, req.user.id, {
        note: b.note,
      });
      return res.json({ data: result });
    }
    const result = await db.transaction(async (tx) => {
      const updated = await one(
        tx,
        "UPDATE subscription_payments SET status='REJECTED',reviewed_by=$2 WHERE id=$1 AND status='PENDING' RETURNING *",
        [p.id, req.user.id],
      );
      if (!updated) fail(409, "This payment has already been reviewed.");
      await subscriptionEvent(
        tx,
        p.school_id,
        req.user.id,
        "PAYMENT_REJECTED",
        { payment_id: p.id, note: b.note },
      );
      return updated;
    });
    res.json({ data: result });
  });
  return r;
}
