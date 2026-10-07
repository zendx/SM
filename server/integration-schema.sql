CREATE TABLE IF NOT EXISTS school_integrations (
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('smtp','paystack','flutterwave','twilio')),
  encrypted_config TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, provider)
);
ALTER TABLE school_integrations DROP CONSTRAINT IF EXISTS school_integrations_provider_check;
ALTER TABLE school_integrations ADD CONSTRAINT school_integrations_provider_check CHECK(provider IN ('smtp','paystack','flutterwave','twilio','manual','stripe','paypal'));
CREATE TABLE IF NOT EXISTS school_payment_transactions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),invoice_id INT NOT NULL REFERENCES student_invoices(id),
 initiated_by INT NOT NULL REFERENCES users(id),provider TEXT NOT NULL CHECK(provider IN ('manual','stripe','paypal','flutterwave')),
 reference TEXT NOT NULL UNIQUE,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('TEST','LIVE')),status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','TEST_CONFIRMED','REVIEW','FAILED')),
 provider_id TEXT,payment_id INT REFERENCES payments(id),review_note TEXT NOT NULL DEFAULT '',
 transfer_reference TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,invoice_id) REFERENCES student_invoices(school_id,id),
 FOREIGN KEY(school_id,initiated_by) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,payment_id) REFERENCES payments(school_id,id)
);
