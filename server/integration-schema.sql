CREATE TABLE IF NOT EXISTS school_integrations (
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('smtp','paystack','flutterwave','twilio')),
  encrypted_config TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, provider)
);
