ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS auto_renew_requested BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS automatic BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS renewal_due_at TIMESTAMPTZ;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS automatic_action_url TEXT;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS auto_renew_revoked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS subscription_auto_renewals (
 school_id INT PRIMARY KEY REFERENCES schools(id),
 enabled BOOLEAN NOT NULL DEFAULT true,
 provider TEXT NOT NULL CHECK(provider IN ('stripe','paystack','flutterwave')),
 encrypted_method TEXT NOT NULL,
 card_brand TEXT NOT NULL DEFAULT '', card_last4 TEXT NOT NULL DEFAULT '',
 source_payment_id INT NOT NULL REFERENCES subscription_payments(id),
 authorized_by INT NOT NULL REFERENCES users(id), authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 revoked_at TIMESTAMPTZ,
 billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('MONTHLY','YEARLY')),
 amount_cents INT NOT NULL, charge_amount_cents BIGINT NOT NULL, charge_currency TEXT NOT NULL,
 pending_payment_id INT REFERENCES subscription_payments(id),
 attempted_period_end TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ,
 claim_token TEXT, claimed_until TIMESTAMPTZ,
 last_status TEXT NOT NULL DEFAULT 'READY', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE subscription_auto_renewals ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS subscription_auto_renewals_due ON subscription_auto_renewals(next_attempt_at) WHERE enabled;
