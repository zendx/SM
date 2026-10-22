import { one, rows, insert } from "./db.js";
import { token } from "./security.js";
import { decryptConfig } from "./integrations.js";
import {
  providerConfig,
  providerRequest,
  verifyAlternativePayment,
} from "./saas-providers.js";
import { settleSubscriptionPayment } from "./saas-service.js";

const retryHours = 12;
const terminal = new Set(["PAID", "REJECTED", "REVIEW", "TEST_CONFIRMED"]);

async function reserve(db, schoolId) {
  return db.transaction(async (tx) => {
    const sub = await one(
      tx,
      "SELECT * FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
      [schoolId],
    );
    const renewal = await one(
      tx,
      "SELECT * FROM subscription_auto_renewals WHERE school_id=$1 FOR UPDATE",
      [schoolId],
    );
    if (!sub || !renewal || new Date(renewal.claimed_until || 0) > new Date())
      return null;
    const settings = await one(
      tx,
      "SELECT grace_days FROM saas_settings WHERE id=1",
    );
    const now = Date.now(),
      due = new Date(sub.period_end).getTime();
    const graceEnd = due + Number(settings.grace_days) * 86400000;
    const eligible =
      renewal.enabled &&
      sub.plan === "PRO" &&
      !sub.deletion_requested_at &&
      !sub.closed_at &&
      (sub.status === "ACTIVE" ||
        (sub.status === "SUSPENDED" && sub.suspension_reason === "OVERDUE")) &&
      !(await one(
        tx,
        "SELECT o.user_id FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=$1",
        [schoolId],
      ));
    let payment = renewal.pending_payment_id
      ? await one(tx, "SELECT * FROM subscription_payments WHERE id=$1", [
          renewal.pending_payment_id,
        ])
      : null;
    if (!payment) {
      const firstAttempt =
        new Date(renewal.attempted_period_end || 0).getTime() !== due;
      // With zero grace there is one initial attempt, within 12h of expiry, and no retries.
      if (
        !eligible ||
        now < due ||
        (now > graceEnd &&
          !(
            firstAttempt &&
            settings.grace_days === 0 &&
            now < due + 12 * 3600000
          )) ||
        (!firstAttempt &&
          new Date(renewal.next_attempt_at || 0).getTime() > now)
      )
        return null;
      // Allow an in-progress manual checkout to finish before starting another payment.
      if (
        await one(
          tx,
          `SELECT id FROM subscription_payments WHERE school_id=$1 AND status='PENDING'
        AND NOT automatic AND created_at>now()-interval '24 hours' LIMIT 1`,
          [schoolId],
        )
      )
        return null;
      const payer = await one(
        tx,
        "SELECT id FROM users WHERE id=$1 AND school_id=$2 AND role='SUPER_ADMIN' AND status='ACTIVE'",
        [renewal.authorized_by, schoolId],
      );
      if (!payer) return null;
      payment = await insert(tx, "subscription_payments", {
        school_id: schoolId,
        reference: "SMPIS-AUTO-" + token().slice(0, 20),
        billing_cycle: renewal.billing_cycle,
        amount_cents: renewal.amount_cents,
        charge_amount_cents: renewal.charge_amount_cents,
        charge_currency: renewal.charge_currency,
        method: "CARD",
        provider: renewal.provider,
        mode: "LIVE",
        initiated_by: payer.id,
        automatic: true,
        renewal_due_at: sub.period_end,
      });
      await tx.query(
        `UPDATE subscription_auto_renewals SET pending_payment_id=$2,attempted_period_end=$3,
        next_attempt_at=now()+interval '12 hours',last_status='PROCESSING' WHERE school_id=$1`,
        [schoolId, payment.id, sub.period_end],
      );
    }
    const claim = token();
    await tx.query(
      "UPDATE subscription_auto_renewals SET claim_token=$2,claimed_until=now()+interval '5 minutes',last_checked_at=now() WHERE school_id=$1",
      [schoolId, claim],
    );
    return { sub, renewal, payment, claim, eligible, graceEnd };
  });
}

async function paymentIssue(db, payment, pending = false) {
  const school = await one(
    db,
    "SELECT name,timezone FROM schools WHERE id=$1",
    [payment.school_id],
  );
  const sub = await one(
    db,
    "SELECT period_end FROM school_subscriptions WHERE school_id=$1",
    [payment.school_id],
  );
  // A concurrent successful/manual renewal makes an old failure notice irrelevant.
  if (new Date(sub.period_end) > new Date(payment.renewal_due_at)) return;
  const settings = await one(
    db,
    "SELECT grace_days FROM saas_settings WHERE id=1",
  );
  const graceEnd = new Date(
    new Date(sub.period_end).getTime() + settings.grace_days * 86400000,
  );
  const deadline = graceEnd.toLocaleString("en-GB", {
    timeZone: school.timezone,
  });
  const body = pending
    ? `Hello,\n\nA small billing update for ${school.name}: we could not yet confirm your automatic SMPIS renewal. We are checking this payment before making another charge.\n\nPlease open Subscription to review the payment status. If your bank asks you to authorize the payment, complete a card payment there once the pending payment is resolved. Access follows your existing expiry and grace period, ending ${deadline} (${school.timezone}).\n\nIf you have already paid, thank you. Please contact Support if you need a hand.`
    : `Hello,\n\nA small billing update for ${school.name}: we were unable to charge your saved card for your SMPIS renewal.\n\nPlease open Subscription and pay or update your card to continue using SMPIS. If automatic renewal remains enabled, we will try again every ${retryHours} hours during your grace period. Your current access deadline is ${deadline} (${school.timezone}); school records remain safely stored if access expires.\n\nIf you have already renewed, thank you and please disregard this message. Our Support team is here if you need help.`;
  await db.query(
    `INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key)
    SELECT school_id,id,email,$2,$3,$4||':'||id FROM users WHERE school_id=$1
    AND role='SUPER_ADMIN' AND status='ACTIVE'
    ON CONFLICT(school_id,dedupe_key) DO NOTHING`,
    [
      payment.school_id,
      "A quick update about your SMPIS renewal",
      body,
      `auto-renewal-issue:${payment.id}`,
    ],
  );
}

async function verifyStripe(db, p, intent, method) {
  if (
    intent.id !== p.provider_id ||
    intent.livemode !== true ||
    intent.currency !== p.charge_currency.toLowerCase() ||
    Number(intent.amount) !== Number(p.charge_amount_cents) ||
    intent.metadata?.reference !== p.reference ||
    intent.customer !== method.customer ||
    intent.payment_method !== method.payment_method
  )
    throw new Error("Automatic renewal verification mismatch.");
  if (intent.status === "succeeded") {
    if (Number(intent.amount_received) !== Number(p.charge_amount_cents))
      throw new Error("Automatic renewal amount mismatch.");
    return settleSubscriptionPayment(db, p.id, null, { providerId: intent.id });
  }
  return null;
}

async function chargeOrReconcile(db, state, c, method) {
  let p = state.payment;
  if (terminal.has(p.status)) return p;
  const request = (path, body, key) =>
    providerRequest(p.provider, c, path, body, key);
  // A revocation, deletion, owner suspension, or another renewal stops new debits.
  const current = await one(
    db,
    `SELECT a.enabled,s.period_end,s.status,s.suspension_reason,s.deletion_requested_at
    FROM subscription_auto_renewals a JOIN school_subscriptions s USING(school_id) WHERE a.school_id=$1`,
    [p.school_id],
  );
  const canSubmit =
    current.enabled &&
    !current.deletion_requested_at &&
    new Date(current.period_end).getTime() ===
      new Date(p.renewal_due_at).getTime() &&
    (current.status === "ACTIVE" ||
      (current.status === "SUSPENDED" &&
        current.suspension_reason === "OVERDUE")) &&
    (Date.now() <= state.graceEnd ||
      (!p.submitted_at &&
        state.graceEnd === new Date(p.renewal_due_at).getTime() &&
        Date.now() < state.graceEnd + 12 * 3600000));
  if (p.provider === "stripe") {
    if (!p.provider_id) {
      if (!canSubmit) return reject(db, p);
      // Create without confirmation, then persist the ID BEFORE any debit. A
      // process crash cannot cause an unrecorded charged PaymentIntent.
      const intent = await request(
        "/payment_intents",
        {
          amount: String(p.charge_amount_cents),
          currency: p.charge_currency.toLowerCase(),
          customer: method.customer,
          payment_method: method.payment_method,
          "payment_method_types[0]": "card",
          "metadata[reference]": p.reference,
          "metadata[school_id]": String(p.school_id),
        },
        p.reference + "-create",
      );
      if (!intent.id) throw new Error("Missing automatic payment ID.");
      await db.query(
        "UPDATE subscription_payments SET provider_id=$2 WHERE id=$1",
        [p.id, intent.id],
      );
      p = { ...p, provider_id: intent.id };
    }
    let intent = await request(
      `/payment_intents/${encodeURIComponent(p.provider_id)}`,
    );
    const paid = await verifyStripe(db, p, intent, method);
    if (paid) return paid;
    if (intent.status === "requires_confirmation") {
      if (!canSubmit) return reject(db, p);
      await db.query(
        "UPDATE subscription_payments SET submitted_at=COALESCE(submitted_at,now()) WHERE id=$1",
        [p.id],
      );
      // Retry the SAME intent/key after connection failures, never create a second charge.
      try {
        intent = await request(
          `/payment_intents/${encodeURIComponent(p.provider_id)}/confirm`,
          { off_session: "true" },
          p.reference + "-confirm",
        );
      } catch {
        intent = await request(
          `/payment_intents/${encodeURIComponent(p.provider_id)}`,
        );
      }
      const confirmed = await verifyStripe(db, p, intent, method);
      if (confirmed) return confirmed;
    }
    if (intent.status === "requires_action") {
      // The tenant must complete a fresh on-session payment. Cancel this intent
      // before allowing retries so it cannot later collect a second payment.
      intent = await request(
        `/payment_intents/${encodeURIComponent(p.provider_id)}/cancel`,
        {},
        p.reference + "-cancel",
      );
    }
    if (["requires_payment_method", "canceled"].includes(intent.status))
      return reject(db, p);
    return p;
  }

  let data;
  if (!p.submitted_at) {
    if (!canSubmit) return reject(db, p);
    await db.query(
      "UPDATE subscription_payments SET submitted_at=now() WHERE id=$1",
      [p.id],
    );
    // Reference/tx_ref is fixed before dispatch. After any ambiguous response
    // workers only VERIFY it; they never resend an authorization charge.
    data =
      p.provider === "paystack"
        ? await request(
            "/transaction/charge_authorization",
            {
              authorization_code: method.authorization_code,
              email: method.email,
              amount: Number(p.charge_amount_cents),
              currency: p.charge_currency,
              reference: p.reference,
            },
            p.reference,
          )
        : await request(
            "/tokenized-charges",
            {
              token: method.token,
              ...(method.country ? { country: method.country } : {}),
              email: method.email,
              amount: Number(p.charge_amount_cents) / 100,
              currency: p.charge_currency,
              tx_ref: p.reference,
            },
            p.reference,
          );
  } else {
    data = await request(
      p.provider === "paystack"
        ? `/transaction/verify/${encodeURIComponent(p.reference)}`
        : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(p.reference)}`,
    );
  }
  const actionUrl =
    data.meta?.authorization?.redirect ||
    data.authorization_url ||
    data.redirect_url;
  if (actionUrl) {
    const url = new URL(actionUrl);
    if (url.protocol === "https:" && !url.username && !url.password)
      await db.query(
        "UPDATE subscription_payments SET automatic_action_url=$2 WHERE id=$1",
        [p.id, url.href],
      );
  }
  if (["success", "successful"].includes(data.status)) {
    const verified = await verifyAlternativePayment(
      db,
      p.provider,
      p.provider === "paystack" ? p.reference : data.id,
      p.school_id,
    );
    if (verified.id !== p.id)
      throw new Error("Automatic payment reference mismatch.");
    return verified;
  }
  if (["failed", "abandoned", "cancelled", "canceled"].includes(data.status))
    return reject(db, p);
  return p;
}

async function reject(db, p) {
  return (
    (await one(
      db,
      "UPDATE subscription_payments SET status='REJECTED' WHERE id=$1 AND status='PENDING' RETURNING *",
      [p.id],
    )) || p
  );
}

export async function runAutoRenewals(db) {
  const candidates = await rows(
    db,
    `SELECT a.school_id,a.provider,a.pending_payment_id FROM subscription_auto_renewals a
    JOIN school_subscriptions s USING(school_id) CROSS JOIN saas_settings c
    WHERE c.id=1 AND (a.claimed_until IS NULL OR a.claimed_until<=now()) AND
    (a.pending_payment_id IS NOT NULL OR (a.enabled AND s.plan='PRO' AND s.period_end<=now()
      AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=now() OR a.attempted_period_end IS DISTINCT FROM s.period_end)
      AND s.period_end+GREATEST(c.grace_days*24,12)*interval '1 hour'>=now()))
    ORDER BY a.last_checked_at NULLS FIRST LIMIT 50`,
  );
  for (const candidate of candidates) {
    const config = await providerConfig(db, candidate.provider);
    if (
      (!config.enabled || config.mode !== "LIVE") &&
      !candidate.pending_payment_id
    )
      continue;
    const state = await reserve(db, candidate.school_id);
    if (!state) continue;
    try {
      const c = config;
      // Saved live methods must never be used with sandbox credentials.
      if (!c.enabled || c.mode !== "LIVE") continue;
      const method = decryptConfig(
        state.renewal.encrypted_method,
        candidate.school_id,
        "auto-renewal",
      );
      const result = await chargeOrReconcile(db, state, c, method);
      if (terminal.has(result.status)) {
        await db.query(
          `UPDATE subscription_auto_renewals SET pending_payment_id=NULL,last_status=$3,updated_at=now()
          WHERE school_id=$1 AND claim_token=$2 AND pending_payment_id=$4`,
          [candidate.school_id, state.claim, result.status, result.id],
        );
        if (result.status === "REJECTED") await paymentIssue(db, result);
      } else await paymentIssue(db, state.payment, true);
    } catch {
      // Network timeouts/ambiguous responses retain the same pending payment.
      // Never start another charge while its outcome is unknown.
      await paymentIssue(db, state.payment, true);
    } finally {
      await db.query(
        "UPDATE subscription_auto_renewals SET claim_token=NULL,claimed_until=NULL WHERE school_id=$1 AND claim_token=$2",
        [candidate.school_id, state.claim],
      );
    }
  }
}
