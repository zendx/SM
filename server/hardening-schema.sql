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

-- Teacher removal hides tenant-facing profiles without destroying historical records.
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_by INT REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_school_archive ON users(school_id,archived_at);

CREATE TABLE IF NOT EXISTS teacher_archives (
 user_id INT PRIMARY KEY REFERENCES users(id),school_id INT NOT NULL REFERENCES schools(id),
 record JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);

-- Retention applies to every school-created account, including former teacher archives.
CREATE TABLE IF NOT EXISTS account_archives (
 user_id INT PRIMARY KEY REFERENCES users(id),school_id INT NOT NULL REFERENCES schools(id),
 record JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
INSERT INTO account_archives(user_id,school_id,record,created_at)
 SELECT user_id,school_id,record,created_at FROM teacher_archives ON CONFLICT(user_id) DO NOTHING;
