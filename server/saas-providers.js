import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "./validation.js";
import { one } from "./db.js";
import { fail } from "./security.js";
import { encrypt, decryptConfig } from "./integrations.js";
import { settleSubscriptionPayment } from "./saas-service.js";

export const providerNames = ["stripe", "paystack", "flutterwave"];
export async function providerConfig(db, provider) {
  const row = await one(
    db,
    "SELECT encrypted_config FROM saas_payment_providers WHERE provider=$1",
    [provider],
  );
  if (row) return decryptConfig(row.encrypted_config, 0, `saas:${provider}`);
  if (provider === "stripe" && process.env.SAAS_STRIPE_SECRET_KEY)
    return {
      enabled: false,
      secret_key: process.env.SAAS_STRIPE_SECRET_KEY,
      webhook_secret: process.env.SAAS_STRIPE_WEBHOOK_SECRET || "",
      mode: process.env.SAAS_STRIPE_SECRET_KEY.startsWith("sk_live_")
        ? "LIVE"
        : "SANDBOX",
      currency: "USD",
      usd_rate: 1,
    };
  return {
    enabled: false,
    mode: "SANDBOX",
    currency: provider === "stripe" ? "USD" : "NGN",
    usd_rate: 1,
    secret_key: "",
    webhook_secret: "",
  };
}
export function redactProvider(c) {
  const { secret_key, webhook_secret, ...rest } = c;
  return {
    ...rest,
    secret_key_configured: !!secret_key,
    webhook_secret_configured: !!webhook_secret,
  };
}
export async function providerSummaries(db) {
  const result = {};
  const config = await one(
    db,
    "SELECT landing_currency,landing_usd_rate FROM saas_settings WHERE id=1",
  );
  for (const provider of providerNames)
    result[provider] = {
      ...redactProvider(await providerConfig(db, provider)),
      currency: config.landing_currency,
      usd_rate: Number(config.landing_usd_rate),
    };
  return result;
}
export async function saveProvider(db, provider, body) {
  const b = z
    .object({
      enabled: z.boolean(),
      mode: z.enum(["SANDBOX", "LIVE"]),
      currency: z.enum(["USD", "NGN"]).optional(),
      usd_rate: z.coerce.number().positive().max(1000000).optional(),
      secret_key: z.string().trim().max(4000).default(""),
      webhook_secret: z.string().trim().max(4000).default(""),
      clear_secrets: z.boolean().default(false),
    })
    .strict()
    .parse(body);
  const old = await providerConfig(db, provider);
  const { clear_secrets, ...c } = b;
  c.currency = c.currency || old.currency;
  c.usd_rate = c.usd_rate ?? old.usd_rate;
  for (const name of ["secret_key", "webhook_secret"])
    c[name] = clear_secrets ? "" : c[name] || old[name] || "";
  if (c.currency === "USD") c.usd_rate = 1;
  if (c.enabled) {
    if (!c.secret_key || !c.webhook_secret)
      fail(
        422,
        "Enter the secret key and webhook secret before enabling this provider.",
      );
    if (
      ["stripe", "paystack"].includes(provider) &&
      !new RegExp(`^sk_${c.mode === "LIVE" ? "live" : "test"}_\\S+$`).test(
        c.secret_key,
      )
    )
      fail(422, "The secret key must match the selected sandbox or live mode.");
    if (provider === "flutterwave" && !/^FLWSECK-/.test(c.secret_key))
      fail(422, "Enter a Flutterwave v3 secret key.");
    if (
      provider === "flutterwave" &&
      /_TEST/.test(c.secret_key) !== (c.mode === "SANDBOX")
    )
      fail(422, "The Flutterwave key must match the selected mode.");
  }
  await db.query(
    "INSERT INTO saas_payment_providers(provider,encrypted_config) VALUES($1,$2) ON CONFLICT(provider) DO UPDATE SET encrypted_config=EXCLUDED.encrypted_config,updated_at=now()",
    [provider, encrypt(c, 0, `saas:${provider}`)],
  );
  return redactProvider(c);
}
export function chargeQuote(usdCents, c) {
  const amount = Math.round(
    usdCents * (c.currency === "USD" ? 1 : Number(c.usd_rate)),
  );
  if (!Number.isSafeInteger(amount) || amount <= 0)
    fail(422, "Invalid payment exchange rate.");
  return { charge_amount_cents: amount, charge_currency: c.currency };
}
export async function providerRequest(provider, c, path, body, idempotency) {
  if (!c.enabled || !c.secret_key)
    fail(503, "This payment provider is not configured or enabled.");
  const base = {
    stripe: "https://api.stripe.com/v1",
    paystack: "https://api.paystack.co",
    flutterwave: "https://api.flutterwave.com/v3",
  }[provider];
  const stripe = provider === "stripe";
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${c.secret_key}`,
      ...(body
        ? {
            "Content-Type": stripe
              ? "application/x-www-form-urlencoded"
              : "application/json",
          }
        : {}),
      ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
    },
    body: body
      ? stripe
        ? new URLSearchParams(body)
        : JSON.stringify(body)
      : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok || (!stripe && ![true, "success"].includes(payload.status)))
    fail(
      502,
      "Payment provider could not process this request. Check credentials and enabled currencies.",
    );
  return stripe ? payload : payload.data;
}
export function equalSecret(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function verifyPaystackSignature(raw, signature, key) {
  return (
    Buffer.isBuffer(raw) &&
    !!key &&
    equalSecret(signature, createHmac("sha512", key).update(raw).digest("hex"))
  );
}
export async function verifyAlternativePayment(
  db,
  provider,
  identifier,
  schoolId = null,
) {
  const c = await providerConfig(db, provider);
  const data = await providerRequest(
    provider,
    c,
    provider === "paystack"
      ? `/transaction/verify/${encodeURIComponent(identifier)}`
      : `/transactions/${encodeURIComponent(identifier)}/verify`,
  );
  const reference = provider === "paystack" ? data.reference : data.tx_ref;
  const p = await one(
    db,
    "SELECT * FROM subscription_payments WHERE provider=$1 AND reference=$2 AND ($3::int IS NULL OR school_id=$3)",
    [provider, String(reference || ""), schoolId],
  );
  if (!p) fail(404, "Payment not found for this school.");
  const amount =
    provider === "paystack"
      ? Number(data.amount)
      : Math.round(Number(data.amount) * 100);
  if (
    data.currency !== p.charge_currency ||
    amount !== Number(p.charge_amount_cents) ||
    c.mode !== p.mode
  )
    fail(422, "Verified payment does not match amount, currency or mode.");
  if (
    provider === "paystack" &&
    data.domain !== (p.mode === "LIVE" ? "live" : "test")
  )
    fail(422, "Payment mode mismatch.");
  if (!["success", "successful"].includes(data.status)) return p;
  return settleSubscriptionPayment(db, p.id, null, {
    testMode: p.mode === "SANDBOX",
    providerId: `${provider}:${data.id}`,
  });
}
