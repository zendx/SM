ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_data TEXT NOT NULL DEFAULT '';
ALTER TABLE users DROP CONSTRAINT IF EXISTS smpis_user_school_or_owner;
ALTER TABLE users ADD CONSTRAINT smpis_user_school_or_owner CHECK(school_id IS NOT NULL OR role IN ('PLATFORM_OWNER','PLATFORM_STAFF','MARKETER'));
INSERT INTO roles(name,permissions) VALUES('MARKETER','[]') ON CONFLICT DO NOTHING;
ALTER TABLE saas_settings ADD COLUMN IF NOT EXISTS referral_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(referral_percent BETWEEN 0 AND 100);
CREATE TABLE IF NOT EXISTS marketers (
 user_id INT PRIMARY KEY REFERENCES users(id), code TEXT NOT NULL UNIQUE,
 bank_name TEXT NOT NULL DEFAULT '',account_number TEXT NOT NULL DEFAULT '',account_name TEXT NOT NULL DEFAULT '',
 closed_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE marketers ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE marketers ADD COLUMN IF NOT EXISTS terms_version TEXT;
CREATE TABLE IF NOT EXISTS school_referrals (
 school_id INT PRIMARY KEY REFERENCES schools(id),marketer_id INT NOT NULL REFERENCES marketers(user_id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_referrals_marketer ON school_referrals(marketer_id);
CREATE TABLE IF NOT EXISTS referral_commissions (
 id SERIAL PRIMARY KEY,marketer_id INT NOT NULL REFERENCES marketers(user_id),school_id INT NOT NULL REFERENCES schools(id),
 payment_id INT NOT NULL UNIQUE REFERENCES subscription_payments(id),
 payment_amount_cents BIGINT NOT NULL CHECK(payment_amount_cents>0),currency TEXT NOT NULL,
 percent NUMERIC(5,2) NOT NULL CHECK(percent BETWEEN 0 AND 100),amount_cents BIGINT NOT NULL CHECK(amount_cents>=0),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID')),
 due_at TIMESTAMPTZ NOT NULL,paid_at TIMESTAMPTZ,paid_by INT REFERENCES users(id),payment_reference TEXT NOT NULL DEFAULT '',
 bank_name TEXT NOT NULL DEFAULT '',account_number TEXT NOT NULL DEFAULT '',account_name TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((status='PENDING' AND paid_at IS NULL) OR (status='PAID' AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND payment_reference<>''))
);
CREATE INDEX IF NOT EXISTS referral_commissions_marketer ON referral_commissions(marketer_id,created_at);
