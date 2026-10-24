# SMPIS

School Management, Performance and Intelligence System built with React, Express, Supabase PostgreSQL and private Supabase Storage. Requires Node.js 22.12 or later.

## Development

Keep existing credentials in the private .env file. For a new installation, copy .env.example and configure the database, storage, application URL, encryption keys and email provider.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. Start background jobs in another terminal with `npm run worker`. Owners sign in at /owner; schools register at /signup.

## Deployment

Vercel runs the Express web app; Railway runs the background worker. Preserve existing encryption keys across both services and all migrations.

Before deploying schema changes, take an encrypted backup and apply the schema from a trusted environment:

```powershell
npm run supabase:setup
npm run supabase:check
npm run preflight:vercel
npm run build:vercel
```

The Vercel build checks configuration, schema protection, encrypted records and private storage before generating frontend assets in public/. Do not bypass a failed preflight. Verify /healthz, sign-in, MFA and document access after deployment.

- [Vercel deployment](docs/VERCEL-DEPLOYMENT.md)
- [Railway worker](docs/RAILWAY-WORKER.md)
- [Email delivery](docs/EMAIL-DELIVERY.md)
- [Brevo setup](docs/BREVO-RAILWAY.md)
- [Subscriptions and payments](docs/SAAS.md)
- [Automatic renewals](docs/AUTOMATIC-RENEWALS.md)
- [School branding and referrals](docs/SCHOOL-BRANDING-AND-REFERRALS.md)
- [Security and recovery](docs/SECURITY-HARDENING-2026-10-21.md)

## Verification

```powershell
npm run test:embedded
npm run build
```

The regression suite uses an isolated embedded PostgreSQL database. `npm test` can also use an isolated schema through TEST_DATABASE_URL; database tests skip if it is absent. Tests never use the application DATABASE_URL.

## Backups

`npm run backup` creates an encrypted SQL and referenced-document backup. Configure a separate BACKUP_ENCRYPTION_KEY and ensure pg_dump is installed. Preserve the key separately from the backup and verify restoration before relying on it. `scripts/decrypt-backup.js` decrypts into a new file without overwriting existing files.

Keep .env, data/ and backups/ private. Build output, test results, caches and local environments are ignored by Git and excluded from deployment. Finished school guides and promotional deliverables remain in docs/.
