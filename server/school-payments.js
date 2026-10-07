import express from "express";
import { integrationConfig } from "./integrations.js";
import { paystackConfig } from "./paystack.js";
import { one, rows, insert, audit } from "./db.js";
import { fail, permitted, token, cents } from "./security.js";
import { z, id } from "./validation.js";
import {
  schoolRecord,
  studentAccess,
  currentSchool,
  recordPayment,
} from "./services.js";

const providers = ["manual", "paypal", "paystack", "flutterwave", "stripe"];
const allowed = (u) =>
  permitted(u, "finance.read") || permitted(u, "finance.own");
async function configFor(db, schoolId, provider) {
  const config = await integrationConfig(db, schoolId, provider);
  if (!config?.enabled) return null;
  if (provider === "manual")
    return config.bank_name && config.account_name && config.account_number
      ? { ...config, mode: "LIVE" }
      : null;
  return { ...config, mode: config.live_enabled ? "LIVE" : "TEST" };
}
async function requestProvider(provider, config, path, body, reference) {
  let authorization = `Bearer ${config.secret_key}`;
  const base =
    provider === "stripe"
      ? "https://api.stripe.com/v1"
      : provider === "flutterwave"
        ? "https://api.flutterwave.com/v3"
        : `https://api-m${config.mode === "TEST" ? ".sandbox" : ""}.paypal.com`;
  if (provider === "paypal") {
    const response = await fetch(base + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${config.client_id}:${config.client_secret}`).toString(
            "base64",
          ),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token)
      fail(
        502,
        "PayPal could not authenticate this school's payment settings.",
      );
    authorization = "Bearer " + data.access_token;
  }
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: authorization,
      "Content-Type":
        provider === "stripe"
          ? "application/x-www-form-urlencoded"
          : "application/json",
      ...(reference
        ? {
            [provider === "paypal" ? "PayPal-Request-Id" : "Idempotency-Key"]:
              reference,
          }
        : {}),
    },
    body: body
      ? provider === "stripe"
        ? new URLSearchParams(body)
        : JSON.stringify(body)
      : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (
    !response.ok ||
    (provider === "flutterwave" && payload.status !== "success")
  )
    fail(
      502,
      "The school's payment provider could not process this request. Please retry or contact school finance.",
    );
  return provider === "flutterwave" ? payload.data : payload;
}
export async function settleSchoolPayment(
  db,
  schoolId,
  reference,
  verified,
  actorId = null,
) {
  return db.transaction(async (tx) => {
    const g = await one(
      tx,
      "SELECT * FROM school_payment_transactions WHERE school_id=$1 AND reference=$2 FOR UPDATE",
      [schoolId, reference],
    );
    if (!g) fail(404, "Payment not found.");
    if (["PAID", "REVIEW", "TEST_CONFIRMED"].includes(g.status)) return g;
    if (
      verified.reference !== g.reference ||
      verified.amount !== Number(g.amount_cents) ||
      verified.currency !== g.currency ||
      verified.mode !== g.mode ||
      verified.id !== g.provider_id
    )
      fail(422, "Payment verification did not match the recorded payment.");
    if (!verified.paid) return g;
    if (g.mode === "TEST")
      return one(
        tx,
        "UPDATE school_payment_transactions SET status='TEST_CONFIRMED' WHERE id=$1 RETURNING *",
        [g.id],
      );
    const invoice = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [schoolId, g.invoice_id],
    );
    let status = "PAID",
      payment = null;
    if (
      invoice.waived ||
      Number(invoice.total_cents) - Number(invoice.paid_cents) <
        Number(g.amount_cents)
    )
      status = "REVIEW";
    else
      payment = await recordPayment(
        { query: tx.query.bind(tx), transaction: (fn) => fn(tx) },
        { school_id: schoolId, id: actorId ?? g.initiated_by },
        {
          invoice_id: g.invoice_id,
          amount_cents: Number(g.amount_cents),
          payment_method: g.provider === "manual" ? "BANK_TRANSFER" : "CARD",
          reference_number: g.transfer_reference || g.reference,
          idempotency_key: `school:${g.reference}`,
        },
      );
    const result = await one(
      tx,
      "UPDATE school_payment_transactions SET status=$2,payment_id=$3,review_note=$4 WHERE id=$1 RETURNING *",
      [
        g.id,
        status,
        payment?.id || null,
        status === "REVIEW"
          ? "Funds received after the invoice balance changed. School finance must reconcile; no duplicate credit was posted."
          : "",
      ],
    );
    await audit(
      tx,
      { school_id: schoolId, id: actorId ?? g.initiated_by },
      "school_payment_transactions",
      g.id,
      "VERIFIED",
      null,
      { status, payment_id: payment?.id || null },
    );
    return result;
  });
}
export function schoolPaymentRoutes(db) {
  const r = express.Router();
  r.use("/payments/school", (req, res, next) => {
    if (!allowed(req.user)) fail(403, "Payment access required.");
    next();
  });
  r.get("/payments/school/methods", async (req, res) => {
    const data = {};
    for (const provider of providers) {
      if (provider === "paystack") {
        const c = await paystackConfig(req.user.school_id, db);
        if (c) data.paystack = { mode: c.mode };
        continue;
      }
      const c = await configFor(db, req.user.school_id, provider);
      if (c)
        data[provider] =
          provider === "manual"
            ? {
                mode: c.mode,
                bank_name: c.bank_name,
                account_name: c.account_name,
                account_number: c.account_number,
                instructions: c.instructions,
              }
            : { mode: c.mode };
    }
    res.json({ data });
  });
  r.get("/payments/school/transactions", async (req, res) =>
    res.json({
      data: await rows(
        db,
        `SELECT g.* FROM school_payment_transactions g JOIN student_invoices i ON i.id=g.invoice_id JOIN students s ON s.id=i.student_id WHERE g.school_id=$1 AND ($2::boolean OR s.parent_user_id=$3) ORDER BY g.id DESC LIMIT 200`,
        [req.user.school_id, req.user.role !== "PARENT", req.user.id],
      ),
    }),
  );
  r.post("/payments/school/checkout", async (req, res) => {
    const u = req.user,
      b = z
        .object({
          provider: z.enum(["manual", "paypal", "stripe", "flutterwave"]),
          invoice_id: id,
          amount: z.string(),
          transfer_reference: z.string().trim().max(200).default(""),
        })
        .parse(req.body);
    const invoice = await schoolRecord(db, u, "student_invoices", b.invoice_id);
    await studentAccess(db, u, invoice.student_id);
    const c = await configFor(db, u.school_id, b.provider);
    if (!c) fail(503, "This payment method is not available for this school.");
    const amount = cents(b.amount);
    if (
      amount <= 0 ||
      invoice.waived ||
      amount > Number(invoice.total_cents) - Number(invoice.paid_cents)
    )
      fail(422, "Choose an amount within the outstanding balance.");
    if (b.provider === "manual" && !b.transfer_reference)
      fail(422, "Enter your bank transfer reference.");
    const school = await currentSchool(db, u),
      reference = `FEE-${u.school_id}-${token().slice(0, 24)}`;
    let origin;
    if (b.provider !== "manual") {
      try {
        origin = new URL(process.env.APP_URL);
      } catch {
        fail(503, "The payment callback address is not configured.");
      }
      if (c.mode === "LIVE" && origin.protocol !== "https:")
        fail(503, "Live payments require an HTTPS application address.");
    }
    const g = await insert(db, "school_payment_transactions", {
      school_id: u.school_id,
      invoice_id: invoice.id,
      initiated_by: u.id,
      provider: b.provider,
      reference,
      amount_cents: amount,
      currency: school.currency_code,
      mode: c.mode,
      transfer_reference: b.transfer_reference,
    });
    if (b.provider === "manual")
      return res.status(201).json({
        data: {
          ...g,
          message: "Transfer submitted for school finance to confirm receipt.",
        },
      });
    const callback = new URL(`/${school.portal_slug}/`, origin);
    callback.searchParams.set("school_payment_reference", reference);
    callback.hash = "finance";
    try {
      let data, url;
      if (b.provider === "stripe") {
        data = await requestProvider(
          "stripe",
          c,
          "/checkout/sessions",
          {
            mode: "payment",
            client_reference_id: reference,
            customer_email: u.email,
            success_url: callback.href,
            cancel_url: new URL(`/${school.portal_slug}/#finance`, origin).href,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]":
              school.currency_code.toLowerCase(),
            "line_items[0][price_data][unit_amount]": String(amount),
            "line_items[0][price_data][product_data][name]":
              "School fee payment",
          },
          reference,
        );
        url = data.url;
      } else if (b.provider === "flutterwave") {
        data = await requestProvider(
          "flutterwave",
          c,
          "/payments",
          {
            tx_ref: reference,
            amount: amount / 100,
            currency: school.currency_code,
            redirect_url: callback.href,
            customer: { email: u.email, name: u.name },
          },
          reference,
        );
        url = data.link;
      } else {
        data = await requestProvider(
          "paypal",
          c,
          "/v2/checkout/orders",
          {
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: reference,
                custom_id: reference,
                amount: {
                  currency_code: school.currency_code,
                  value: (amount / 100).toFixed(2),
                },
              },
            ],
            application_context: {
              return_url: callback.href,
              cancel_url: new URL(`/${school.portal_slug}/#finance`, origin)
                .href,
            },
          },
          reference,
        );
        url = data.links?.find((l) => l.rel === "approve")?.href;
      }
      if (!url || !/^https:\/\//.test(url))
        fail(
          502,
          "The payment provider did not return a secure checkout address.",
        );
      await db.query(
        "UPDATE school_payment_transactions SET provider_id=$2 WHERE id=$1",
        [g.id, data.id ? String(data.id) : reference],
      );
      res.status(201).json({ data: { reference, url } });
    } catch (e) {
      await db.query(
        "UPDATE school_payment_transactions SET status='FAILED' WHERE id=$1",
        [g.id],
      );
      throw e;
    }
  });
  r.post("/payments/school/verify", async (req, res) => {
    const u = req.user,
      b = z
        .object({
          reference: z.string().regex(/^FEE-\d+-[a-f0-9]{24}$/),
          confirm_manual: z.boolean().default(false),
        })
        .parse(req.body);
    const g = await one(
      db,
      "SELECT * FROM school_payment_transactions WHERE school_id=$1 AND reference=$2",
      [u.school_id, b.reference],
    );
    if (!g) fail(404, "Payment not found.");
    const invoice = await schoolRecord(db, u, "student_invoices", g.invoice_id);
    await studentAccess(db, u, invoice.student_id);
    if (["PAID", "REVIEW", "TEST_CONFIRMED"].includes(g.status))
      return res.json({ data: g });
    if (g.status === "FAILED")
      fail(422, "This checkout failed. Start a new payment.");
    const c = await configFor(db, u.school_id, g.provider);
    if (!c || c.mode !== g.mode)
      fail(
        503,
        "Payment settings have changed. Contact school finance to reconcile this payment.",
      );
    let verified = {
      id: g.provider_id,
      reference: g.reference,
      amount: Number(g.amount_cents),
      currency: g.currency,
      mode: g.mode,
      paid: false,
    };
    if (g.provider === "manual") {
      if (!permitted(u, "finance.write") || !b.confirm_manual)
        fail(403, "School finance must confirm the actual bank receipt.");
      verified.paid = true;
    } else if (g.provider === "stripe") {
      const d = await requestProvider(
        "stripe",
        c,
        `/checkout/sessions/${encodeURIComponent(g.provider_id)}`,
      );
      verified = {
        id: d.id,
        reference: d.client_reference_id,
        amount: d.amount_total,
        currency: d.currency?.toUpperCase(),
        mode: d.livemode ? "LIVE" : "TEST",
        paid: d.payment_status === "paid",
      };
    } else if (g.provider === "flutterwave") {
      const d = await requestProvider(
        "flutterwave",
        c,
        `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(g.reference)}`,
      );
      verified = {
        id: g.provider_id,
        reference: d.tx_ref,
        amount: Math.round(Number(d.amount) * 100),
        currency: d.currency,
        mode: c.mode,
        paid: d.status === "successful",
      };
    } else {
      let d = await requestProvider(
        "paypal",
        c,
        `/v2/checkout/orders/${encodeURIComponent(g.provider_id)}`,
      );
      if (d.status === "APPROVED")
        d = await requestProvider(
          "paypal",
          c,
          `/v2/checkout/orders/${encodeURIComponent(g.provider_id)}/capture`,
          {},
          `capture-${g.reference}`,
        );
      const unit = d.purchase_units?.[0],
        capture = unit?.payments?.captures?.[0];
      verified = {
        id: d.id,
        reference: unit?.custom_id || unit?.reference_id,
        amount: Math.round(Number(capture?.amount?.value) * 100),
        currency: capture?.amount?.currency_code,
        mode: c.mode,
        paid: d.status === "COMPLETED" && capture?.status === "COMPLETED",
      };
      if (!verified.paid) return res.json({ data: g });
    }
    res.json({
      data: await settleSchoolPayment(
        db,
        u.school_id,
        g.reference,
        verified,
        u.id,
      ),
    });
  });
  return r;
}
