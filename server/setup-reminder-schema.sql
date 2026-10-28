CREATE TABLE IF NOT EXISTS tenant_setup_reminders (
 school_id INT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 next_send_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '2 days',
 sent_count INT NOT NULL DEFAULT 0 CHECK(sent_count BETWEEN 0 AND 10),
 last_sent_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,
 attempts INT NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',
 claim_token TEXT,claimed_until TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tenant_setup_reminders_due
 ON tenant_setup_reminders(next_send_at) WHERE completed_at IS NULL AND sent_count<10;
