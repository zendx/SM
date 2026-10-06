import { integrationConfig } from "./integrations.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { one, rows, insert, audit } from "./db.js";
import { fail, permitted, token, cents } from "./security.js";
import {
  schoolRecord,
  studentAccess,
  recordPayment,
  currentSchool,
} from "./services.js";
import { z, id } from "./validation.js";
import express from "express";
export async function paystackConfig(schoolId, db) {
  const saved = db ? await integrationConfig(db, schoolId, "paystack") : null;
  if (saved) {
    if (!saved.enabled || !/^sk_(test|live)_/.test(saved.secret_key)) return null;
    const mode = saved.secret_key.startsWith("sk_test_") ? "TEST" : "LIVE";
    if (mode === "LIVE" && !saved.live_enabled) return null;
    return { key: saved.secret_key, mode };
  }
  let keys = {};
  try {
    keys = JSON.parse(process.env.PAYSTACK_SCHOOL_KEYS_JSON || "{}");
  } catch {
    fail(503, "Payment configuration needs operator attention.");
  }
  const key = keys[String(schoolId)];
  if (!key || !/^sk_(test|live)_/.test(key)) return null;
  const mode = key.startsWith("sk_test_") ? "TEST" : "LIVE";
  if (mode === "LIVE" && process.env.PAYSTACK_LIVE_ENABLED !== "true")
    return null;
  return { key, mode };
}
export async function paystackRequest(key, path, body) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.status)
    fail(
      502,
      "Paystack could not process this request. Please retry or contact finance.",
    );
  return payload.data;
}
export async function settlePaystack(db, schoolId, data) {
  return db.transaction(async (tx) => {
    const g = await one(
      tx,
      "SELECT * FROM gateway_transactions WHERE school_id=$1 AND reference=$2 FOR UPDATE",
      [schoolId, String(data.reference || "")],
    );
    if (!g) fail(404, "Payment reference not found.");
    if (["PAID", "TEST_CONFIRMED", "REVIEW"].includes(g.status)) return g;
    const config = await paystackConfig(schoolId, tx);
    if (!config) fail(503, "Paystack is not configured for this school.");
    if (data.status !== "success") return g;
    if (
      !Number.isSafeInteger(data.amount) ||
      data.amount !== Number(g.amount_cents) ||
      data.currency !== g.currency ||
      data.domain !== g.mode.toLowerCase() ||
      config.mode !== g.mode
    )
      fail(
        422,
        "Payment verification did not match the recorded amount, currency or mode.",
      );
    if (g.mode === "TEST") {
      await tx.query(
        "UPDATE gateway_transactions SET status='TEST_CONFIRMED',provider_id=$2 WHERE id=$1",
        [g.id, String(data.id)],
      );
      return { ...g, status: "TEST_CONFIRMED" };
    }
    const invoice = await one(
      tx,
      "SELECT * FROM student_invoices WHERE school_id=$1 AND id=$2 FOR UPDATE",
      [schoolId, g.invoice_id],
    );
    let payment = null,
      status = "PAID",
      review = "";
    if (
      invoice.waived ||
      Number(invoice.total_cents) - Number(invoice.paid_cents) <
        Number(g.amount_cents)
    ) {
      status = "REVIEW";
      review =
        "Paystack confirmed funds after the invoice balance changed. Finance must reconcile the excess; no duplicate credit was posted.";
    } else
      payment = await recordPayment(
        { query: tx.query.bind(tx), transaction: (fn) => fn(tx) },
        { school_id: schoolId, id: g.initiated_by },
        {
          invoice_id: g.invoice_id,
          amount_cents: Number(g.amount_cents),
          payment_method: "CARD",
          reference_number: g.reference,
          idempotency_key: `paystack:${g.reference}`,
        },
      );
    await tx.query(
      "UPDATE gateway_transactions SET status=$2,provider_id=$3,payment_id=$4,review_note=$5 WHERE id=$1",
      [g.id, status, String(data.id), payment?.id || null, review],
    );
    await audit(
      tx,
      { school_id: schoolId, id: g.initiated_by },
      "gateway_transactions",
      g.id,
      "VERIFIED",
      null,
      { status, payment_id: payment?.id || null },
    );
    return {
      ...g,
      status,
      payment_id: payment?.id || null,
      review_note: review,
    };
  });
}
export function paystackWebhook(db) {
  return async (req, res) => {
    const schoolId = id.parse(req.params.school),
      config = await paystackConfig(schoolId, db);
    if (!config) fail(503, "Payment integration is unavailable.");
    const signature = req.get("x-paystack-signature") || "";
    if (!/^[a-f0-9]{128}$/i.test(signature))
      fail(401, "Invalid webhook signature.");
    const expected = createHmac("sha512", config.key)
      .update(req.rawBody || Buffer.alloc(0))
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
      fail(401, "Invalid webhook signature.");
    if (req.body.event === "charge.success")
      await settlePaystack(db, schoolId, req.body.data || {});
    res.json({ received: true });
  };
}
export function paymentRoutes(db, { gatewayRequest = paystackRequest } = {}) {
  const r = express.Router();
  const allowed = (u) =>
    permitted(u, "finance.read") || permitted(u, "finance.own");
  r.get("/payments/config", async (req, res) => {
    if (!allowed(req.user)) fail(403, "Payment access required.");
    const c = await paystackConfig(req.user.school_id, db);
    res.json({ data: { configured: !!c, mode: c?.mode || null } });
  });
  r.get("/payments/transactions", async (req, res) => {
    if (!allowed(req.user)) fail(403, "Payment access required.");
    const u = req.user;
    res.json({
      data: await rows(
        db,
        `SELECT g.id,g.invoice_id,g.reference,g.amount_cents,g.currency,g.mode,g.status,g.review_note,g.created_at FROM gateway_transactions g JOIN student_invoices i ON i.id=g.invoice_id JOIN students s ON s.id=i.student_id WHERE g.school_id=$1${u.role === "PARENT" ? " AND s.parent_user_id=$2" : ""} ORDER BY g.id DESC LIMIT 200`,
        u.role === "PARENT" ? [u.school_id, u.id] : [u.school_id],
      ),
    });
  });
  r.post("/payments/paystack/initialize", async (req, res) => {
    const u = req.user;
    if (!allowed(u)) fail(403, "Payment access required.");
    const b = z.object({ invoice_id: id, amount: z.string() }).parse(req.body),
      invoice = await schoolRecord(db, u, "student_invoices", b.invoice_id);
    await studentAccess(db, u, invoice.student_id);
    const config = await paystackConfig(u.school_id, db);
    if (!config) fail(503, "Online payment is not configured for this school.");
    let origin;
    try {
      origin = new URL(process.env.APP_URL);
    } catch {
      fail(503, "The payment callback address is not configured.");
    }
    if (origin.protocol !== "https:" && config.mode === "LIVE")
      fail(503, "Live payment requires an HTTPS application address.");
    const amount = cents(b.amount);
    if (
      amount <= 0 ||
      invoice.waived ||
      amount > Number(invoice.total_cents) - Number(invoice.paid_cents)
    )
      fail(422, "Choose an amount within the outstanding balance.");
    const school = await currentSchool(db, u),
      reference = `SMP-${u.school_id}-${token().slice(0, 24)}`;
    const g = await insert(db, "gateway_transactions", {
      school_id: u.school_id,
      invoice_id: invoice.id,
      initiated_by: u.id,
      reference,
      amount_cents: amount,
      currency: school.currency_code,
      mode: config.mode,
    });
    const callback = new URL("/", origin);
    callback.searchParams.set("payment_reference", reference);
    try {
      const result = await gatewayRequest(
        config.key,
        "/transaction/initialize",
        {
          email: u.email,
          amount,
          currency: school.currency_code,
          reference,
          callback_url: callback.href,
          metadata: { school_id: u.school_id, invoice_id: invoice.id },
        },
      );
      const url = new URL(result.authorization_url);
      if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com")
        fail(502, "Unexpected payment checkout address.");
      await db.query(
        "UPDATE gateway_transactions SET status='INITIALIZED',authorization_url=$2 WHERE id=$1",
        [g.id, url.href],
      );
      await audit(db, u, "gateway_transactions", g.id, "INITIALIZE", null, {
        invoice_id: invoice.id,
        amount_cents: amount,
        mode: config.mode,
      });
      res.json({
        data: { reference, authorization_url: url.href, mode: config.mode },
      });
    } catch (e) {
      await db.query(
        "UPDATE gateway_transactions SET status='FAILED' WHERE id=$1",
        [g.id],
      );
      throw e;
    }
  });
  r.post("/payments/paystack/verify", async (req, res) => {
    const u = req.user;
    if (!allowed(u)) fail(403, "Payment access required.");
    const reference = z
        .string()
        .regex(/^SMP-\d+-[a-f0-9]{24}$/)
        .parse(req.body.reference),
      g = await one(
        db,
        "SELECT * FROM gateway_transactions WHERE school_id=$1 AND reference=$2",
        [u.school_id, reference],
      );
    if (!g) fail(404, "Payment not found.");
    const invoice = await schoolRecord(db, u, "student_invoices", g.invoice_id);
    await studentAccess(db, u, invoice.student_id);
    const config = await paystackConfig(u.school_id, db);
    if (!config) fail(503, "Payment integration unavailable.");
    const data = await gatewayRequest(
      config.key,
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    res.json({ data: await settlePaystack(db, u.school_id, data) });
  });
  return r;
}
