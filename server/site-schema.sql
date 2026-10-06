CREATE TABLE IF NOT EXISTS site_legal_settings (
  id INT PRIMARY KEY CHECK (id=1),
  organization TEXT NOT NULL,
  privacy_email TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
