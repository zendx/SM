ALTER TABLE schools ADD COLUMN IF NOT EXISTS portal_slug TEXT;
UPDATE schools SET portal_slug='school-' || lower(short_code) WHERE portal_slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_portal_slug_unique ON schools(portal_slug);

CREATE TABLE IF NOT EXISTS saas_settings (
 id INT PRIMARY KEY CHECK(id=1), bank_name TEXT NOT NULL DEFAULT '',
 account_name TEXT NOT NULL DEFAULT '', account_number TEXT NOT NULL DEFAULT '',
 bank_currency TEXT NOT NULL DEFAULT 'USD', bank_instructions TEXT NOT NULL DEFAULT '',
 bank_usd_rate NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK(bank_usd_rate>0),
 grace_days INT NOT NULL DEFAULT 0 CHECK(grace_days BETWEEN 0 AND 30),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO saas_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE saas_settings ADD COLUMN IF NOT EXISTS landing_currency TEXT NOT NULL DEFAULT 'USD' CHECK(landing_currency IN ('USD','NGN'));
ALTER TABLE saas_settings ADD COLUMN IF NOT EXISTS landing_usd_rate NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK(landing_usd_rate>0);
CREATE TABLE IF NOT EXISTS school_subscriptions (
 school_id INT PRIMARY KEY REFERENCES schools(id),
 plan TEXT NOT NULL CHECK(plan IN ('FREE','PRO')),
 billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY' CHECK(billing_cycle IN ('MONTHLY','YEARLY')),
 status TEXT NOT NULL CHECK(status IN ('TRIAL','ACTIVE','PENDING_PAYMENT','SUSPENDED','TERMINATED')),
 trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 days',
 period_end TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 days',
 suspension_reason TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Upgrade existing 14-day trials once, preserving their original start date.
ALTER TABLE saas_settings ADD COLUMN IF NOT EXISTS trial_days INT NOT NULL DEFAULT 14;
UPDATE school_subscriptions SET trial_ends_at=trial_ends_at+interval '16 days',
 period_end=CASE WHEN plan='FREE' THEN period_end+interval '16 days' ELSE period_end END,
 status=CASE WHEN plan='FREE' AND suspension_reason='TRIAL_EXPIRED' AND period_end+interval '16 days'>now() THEN 'TRIAL' ELSE status END,
 suspension_reason=CASE WHEN plan='FREE' AND suspension_reason='TRIAL_EXPIRED' AND period_end+interval '16 days'>now() THEN '' ELSE suspension_reason END
 WHERE (SELECT trial_days FROM saas_settings WHERE id=1)=14;
UPDATE saas_settings SET trial_days=30 WHERE id=1;
ALTER TABLE saas_settings ALTER COLUMN trial_days SET DEFAULT 30;
ALTER TABLE school_subscriptions ALTER COLUMN trial_ends_at SET DEFAULT now()+interval '30 days';
ALTER TABLE school_subscriptions ALTER COLUMN period_end SET DEFAULT now()+interval '30 days';
INSERT INTO school_subscriptions(school_id,plan,status)
 SELECT id,'FREE','TRIAL' FROM schools ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS subscription_payments (
 id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
 reference TEXT NOT NULL UNIQUE, billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('MONTHLY','YEARLY')),
 amount_cents INT NOT NULL CHECK(amount_cents IN (10000,102000)), currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 method TEXT NOT NULL CHECK(method IN ('BANK','CARD')),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','REJECTED','TEST_CONFIRMED','REVIEW')),
 transfer_reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
 provider_id TEXT UNIQUE, initiated_by INT NOT NULL REFERENCES users(id),
 provider TEXT CHECK(provider IN ('stripe','paystack','flutterwave')),
 mode TEXT NOT NULL DEFAULT 'SANDBOX' CHECK(mode IN ('SANDBOX','LIVE')),
 charge_amount_cents BIGINT, charge_currency TEXT,
 reviewed_by INT REFERENCES users(id), paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_school ON subscription_payments(school_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_bank_reference_unique
 ON subscription_payments(school_id,lower(transfer_reference))
 WHERE method='BANK' AND status<>'REJECTED' AND transfer_reference<>'';
CREATE TABLE IF NOT EXISTS saas_payment_providers (
 provider TEXT PRIMARY KEY CHECK(provider IN ('stripe','paystack','flutterwave')),
 encrypted_config TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscription_events (
 id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),
 actor_id INT REFERENCES users(id), action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A platform owner is an account in the business, with no school or subscription.
ALTER TABLE users ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE subscription_events ALTER COLUMN school_id DROP NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='smpis_user_school_or_owner' AND conrelid='users'::regclass) THEN
  ALTER TABLE users ADD CONSTRAINT smpis_user_school_or_owner CHECK(school_id IS NOT NULL OR role='PLATFORM_OWNER');
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS saas_support_tickets (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),
 user_id INT NOT NULL REFERENCES users(id),subject TEXT NOT NULL,description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')),
 resolution TEXT NOT NULL DEFAULT '',updated_by INT REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_support_status ON saas_support_tickets(status,updated_at);

-- Legacy provisioning paths must also create a valid subscription and portal.
CREATE OR REPLACE FUNCTION smpis_school_portal_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.portal_slug IS NULL THEN NEW.portal_slug := 'school-' || lower(NEW.short_code); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS smpis_school_portal_default ON schools;
CREATE TRIGGER smpis_school_portal_default BEFORE INSERT ON schools
 FOR EACH ROW EXECUTE FUNCTION smpis_school_portal_default();
CREATE OR REPLACE FUNCTION smpis_school_trial_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO school_subscriptions(school_id,plan,status) VALUES(NEW.id,'FREE','TRIAL');
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS smpis_school_trial_default ON schools;
CREATE TRIGGER smpis_school_trial_default AFTER INSERT ON schools
 FOR EACH ROW EXECUTE FUNCTION smpis_school_trial_default();

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS email_verification_tokens (
 token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- School users stay scoped to their school. Designated owners may be recorded
-- as the actor in any school without inventing another user identity.
CREATE OR REPLACE FUNCTION smpis_check_school_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor INT;
BEGIN
 actor := (to_jsonb(NEW)->>TG_ARGV[0])::int;
 IF actor IS NOT NULL AND NEW.school_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM users u WHERE u.id=actor AND
   (u.school_id=NEW.school_id OR EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id))
 ) THEN
   RAISE EXCEPTION 'User does not belong to this school' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
DO $$
DECLARE relation RECORD; column_name TEXT; trigger_name TEXT;
BEGIN
 FOR relation IN
   SELECT c.conname,c.conrelid,t.relname,c.conkey
   FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
   WHERE c.contype='f' AND c.confrelid='users'::regclass AND array_length(c.conkey,1)=2
 LOOP
   SELECT a.attname INTO column_name FROM pg_attribute a
    WHERE a.attrelid=relation.conrelid AND a.attnum=relation.conkey[2];
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',relation.conrelid::regclass,relation.conname);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id)',
     relation.conrelid::regclass,relation.conname,column_name);
   trigger_name := 'smpis_school_user_' || column_name;
   EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s',trigger_name,relation.conrelid::regclass);
   EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %s DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION smpis_check_school_user(%L)',
     trigger_name,relation.conrelid::regclass,column_name);
 END LOOP;
END $$;

-- Delegated console accounts never become platform operators.
INSERT INTO roles(name,permissions) VALUES('PLATFORM_STAFF','[]') ON CONFLICT DO NOTHING;
ALTER TABLE users DROP CONSTRAINT IF EXISTS smpis_user_school_or_owner;
ALTER TABLE users ADD CONSTRAINT smpis_user_school_or_owner CHECK(school_id IS NOT NULL OR role IN ('PLATFORM_OWNER','PLATFORM_STAFF'));
CREATE TABLE IF NOT EXISTS platform_staff (
 user_id INT PRIMARY KEY REFERENCES users(id),
 scope TEXT NOT NULL CHECK(scope IN ('SALES','TECHNICAL','SUBSCRIPTIONS')),
 created_by INT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE saas_support_tickets ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT 'TECHNICAL' CHECK(department IN ('SALES','TECHNICAL'));
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS deletion_effective_at TIMESTAMPTZ;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE school_subscriptions ADD COLUMN IF NOT EXISTS tenant_previous_status TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS platform_notifications (
 id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), school_id INT REFERENCES schools(id),
 sender_id INT REFERENCES users(id),email TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,link TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,read_at TIMESTAMPTZ,email_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(email_status IN ('PENDING','SENT','FAILED')),
 attempts INT NOT NULL DEFAULT 0,claim_token TEXT,claimed_until TIMESTAMPTZ,sent_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(user_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS platform_notifications_inbox ON platform_notifications(user_id,created_at DESC);
