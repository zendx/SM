ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE platform_notifications ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE onboarding_email_queue ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS background_worker_status (
 id INT PRIMARY KEY CHECK(id=1),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_started_at TIMESTAMPTZ,last_completed_at TIMESTAMPTZ,last_success_at TIMESTAMPTZ,
 last_error TEXT NOT NULL DEFAULT '',smtp_configured BOOLEAN NOT NULL DEFAULT false
);
ALTER TABLE background_worker_status ADD COLUMN IF NOT EXISTS email_provider TEXT NOT NULL DEFAULT 'smtp';
