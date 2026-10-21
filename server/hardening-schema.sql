ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_counter BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activation_pending BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS verification_outbox (
 id SERIAL PRIMARY KEY,
 user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL REFERENCES email_verification_tokens(token_hash) ON DELETE CASCADE,
 encrypted_token TEXT NOT NULL,
 attempts INT NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 claim_token TEXT,
 claimed_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_outbox_due ON verification_outbox(next_attempt_at);
CREATE TABLE IF NOT EXISTS document_upload_intents (
 storage_key TEXT PRIMARY KEY,
 school_id INT NOT NULL REFERENCES schools(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
