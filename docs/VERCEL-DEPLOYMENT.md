# Vercel deployment

The root `index.js` exports the Express application. Vite builds the frontend into `public`, which Vercel serves as static assets. The API uses Supabase PostgreSQL and private Supabase Storage; existing SMPIS authentication, MFA, and school permissions remain in place.

## Project settings

- Framework preset: **Express** (also enforced by `vercel.json`)
- Root directory: repository root
- Build command: `npm run build:vercel`
- Output directory: `.` (the project root containing the Express `index.js`; frontend assets are still built into `public`)
- Install command: default (`npm install`)

See [Vercel's Express deployment documentation](https://vercel.com/docs/frameworks/backend/express).

## Environment variables

Add these under Vercel Project Settings > Environment Variables for each environment you deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase pooler PostgreSQL connection string with your encoded database password and `sslmode=verify-full`. Use the exact string from Supabase's Connect panel. |
| `SUPABASE_URL` | Your HTTPS Supabase project origin. |
| `SUPABASE_SERVICE_ROLE_KEY` | Your server-only Supabase service-role key. |
| `SUPABASE_STORAGE_BUCKET` | Your private document bucket name, normally `school-documents`. |
| `INTEGRATION_ENCRYPTION_KEY` | The same 64-character hexadecimal key used in your private local `.env`. Preserve it across deployments and restores. |
| `DB_POOL_MAX` | `1` to bound connections per function instance. |
| `APP_URL` | The actual deployed HTTPS origin, used for password resets and payment callbacks. |
| `NODE_ENV` | `production`, to enable secure session cookies. |
| `TRUST_PROXY_HOPS` | `1`. |
| `REQUIRE_MFA` | `true`. |
| `DB_SSL_CA` | Optional trusted database certificate PEM, if required by your connection. |

Do not upload `.env` or put credentials in `VITE_` variables. SMTP and payment credentials can be entered later through Administration > Integrations. Environment `SMTP_URL`, `MAIL_FROM`, `PAYSTACK_SCHOOL_KEYS_JSON`, and `PAYSTACK_LIVE_ENABLED` remain optional compatibility defaults.

If the project already has encrypted integration settings, reuse its existing encryption key rather than generating a replacement.

## Prepare Supabase

Keep your existing `.env`. For a new project, use `.env.example` as a template and replace all placeholders. Then run:

```powershell
npm run supabase:setup
npm run supabase:check
npm test
npm run build:vercel
```

Setup creates or updates application tables, enables RLS, removes direct browser-role grants, and creates the private bucket. Check verifies database access, table protection, and upload/download/delete. Neither command migrates existing local records. Run setup again before deploying schema changes; Vercel cold starts do not run schema migrations.

Documents are limited to 4 MB and PDF, PNG, or JPEG. Storage is private and accessed through authenticated API routes.

## Deploy and verify

Push the repository, import it into Vercel, add the variables, and deploy. When Vercel assigns the deployment URL, update `APP_URL` and redeploy if needed.

- `/healthz` should return `{"status":"ok"}`.
- Verify initial school setup or existing login and administrator MFA.
- Check frontend navigation, private document upload/download, and school access restrictions.
- Test SMTP delivery and Paystack test checkout after configuring those services.

Background jobs run in the separate Railway worker, not in Vercel. See [Railway worker setup](RAILWAY-WORKER.md). Supabase database recovery and storage backups are separate from application deployment. Flutterwave checkout and Twilio SMS are not yet implemented.

If a deployment reports that `functions.index.js` does not match functions in the `api` directory, it is using the generic functions configuration. This project uses native Express detection: keep `framework: "express"` in `vercel.json` and use the wildcard function pattern already in the configuration.

If Vercel reports no entrypoint in `public`, its backend output directory is pointing at the frontend assets. Keep `outputDirectory: "."` in `vercel.json`, and reset any dashboard Output Directory override to `.` or disable that override. The build command continues to generate `public/index.html` and assets.

## Frontend assets

The function bundle explicitly includes `public/**`. JavaScript and CSS requests have dedicated file routes before the SPA fallback, so they receive their correct content type if they reach Express. Missing assets return 404 instead of HTML. The wildcard `functions` pattern applies the bundle inclusion to the detected Express function without relying on its generated entry-point name.

## Legal settings and local databases

Run `npm run supabase:setup` before deploying this version to create `site_legal_settings` with RLS. Super admins publish legal contact details under Administration > Site settings. Supabase is the only database; database switching is unavailable.
