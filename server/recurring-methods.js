import { one } from "./db.js";
import { encrypt } from "./integrations.js";

export async function autoRenewalSummary(db, schoolId) {
  return one(
    db,
    `SELECT enabled,provider,card_brand,card_last4,billing_cycle,
    charge_amount_cents,charge_currency,next_attempt_at,last_status,
    pending_payment_id IS NOT NULL AS payment_pending,
    (SELECT automatic_action_url FROM subscription_payments p WHERE p.id=pending_payment_id) AS action_url
    FROM subscription_auto_renewals WHERE school_id=$1`,
    [schoolId],
  );
}

// Only a verified, successful live payment with explicit checkout consent may
// install a reusable method. Replayed webhooks cannot undo a later revocation.
export async function saveRecurringMethod(db, payment, method, card = {}) {
  if (
    !payment.auto_renew_requested ||
    payment.mode !== "LIVE" ||
    payment.status !== "PAID" ||
    !method
  )
    return;
  return db.transaction(async (tx) => {
    const subscription = await one(
      tx,
      "SELECT auto_renew_revoked_at FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
      [payment.school_id],
    );
    if (
      subscription?.auto_renew_revoked_at &&
      new Date(payment.created_at) <=
        new Date(subscription.auto_renew_revoked_at)
    )
      return;
    const user = await one(tx, "SELECT email FROM users WHERE id=$1", [
      payment.initiated_by,
    ]);
    await tx.query(
      `INSERT INTO subscription_auto_renewals
    (school_id,provider,encrypted_method,card_brand,card_last4,source_payment_id,authorized_by,
     billing_cycle,amount_cents,charge_amount_cents,charge_currency)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT(school_id) DO UPDATE SET enabled=true,provider=EXCLUDED.provider,
      encrypted_method=EXCLUDED.encrypted_method,card_brand=EXCLUDED.card_brand,card_last4=EXCLUDED.card_last4,
      source_payment_id=EXCLUDED.source_payment_id,authorized_by=EXCLUDED.authorized_by,
      authorized_at=now(),revoked_at=NULL,billing_cycle=EXCLUDED.billing_cycle,
      amount_cents=EXCLUDED.amount_cents,charge_amount_cents=EXCLUDED.charge_amount_cents,
      charge_currency=EXCLUDED.charge_currency,next_attempt_at=NULL,last_status='READY',updated_at=now()
    WHERE subscription_auto_renewals.source_payment_id < EXCLUDED.source_payment_id
      AND (subscription_auto_renewals.revoked_at IS NULL OR $12::timestamptz > subscription_auto_renewals.revoked_at)
      AND subscription_auto_renewals.pending_payment_id IS NULL`,
      [
        payment.school_id,
        payment.provider,
        encrypt(
          { ...method, email: method.email || user.email },
          payment.school_id,
          "auto-renewal",
        ),
        String(card.brand || "Card").slice(0, 40),
        /^\d{4}$/.test(card.last4 || "") ? card.last4 : "",
        payment.id,
        payment.initiated_by,
        payment.billing_cycle,
        payment.amount_cents,
        payment.charge_amount_cents,
        payment.charge_currency,
        payment.created_at,
      ],
    );
  });
}
