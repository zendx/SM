# SMPIS

School administration software built with React, Express, Supabase PostgreSQL and private Supabase Storage. Requires Node.js 22.12 or later.

## Development

Preserve the private `.env` and existing encryption keys. For a new installation, copy `.env.example` and replace its placeholders. Never put server credentials in `VITE_` variables or commit `.env`, school records, backups or test output.

```powershell
npm ci
npm run dev
```

The local web server uses http://127.0.0.1:3000. Run `npm run worker` separately for email queues, subscription renewals and other scheduled jobs. Owners sign in at `/owner`; school registration is at `/signup`.

## Deployment and migrations

The root `index.js` exports the Express application for Vercel. `npm run build:vercel` generates frontend assets in `public/`. Keep the Vercel framework preset as Express and output directory as `.`; the backend entrypoint is in the project root. Railway can run the separate background worker using the same database and encryption keys. A local production server uses `npm run build` and `npm start` instead.

Configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `APP_URL` and the encryption keys in each applicable deployment environment. Reuse existing key values when records are already encrypted. Database connections require SSL; `sslmode=verify-full` with a trusted certificate is supported. Configure `NODE_ENV=production`, an HTTPS `APP_URL`, the appropriate `TRUST_PROXY_HOPS`, and `DB_POOL_MAX` for the deployment. Keep privileged-account MFA enabled. Use `.env.example` for remaining provider and worker settings.

Before changing a deployed schema, create a recoverable backup. Apply migrations from a trusted environment, then deploy compatible web and worker releases:

```powershell
npm run backup
npm run supabase:setup
npm run supabase:check
npm run preflight:vercel
npm run build:vercel
```

`supabase:setup` creates or updates application tables, enables RLS, revokes browser-role table grants, migrates encrypted MFA secrets and prepares the private document bucket. `supabase:check` verifies schema protection, direct-conversation schema and private document storage. Setup changes the database; Vercel cold starts do not run migrations. Do not bypass a failed deployment preflight.

Verify `/healthz`, sign-in, activation, MFA recovery, tenant isolation, private document access, billing and worker heartbeat after deployment. Source tests do not verify a deployed environment automatically.

## Email and payment providers

Email requires a configured sender and provider in both web and worker environments. Brevo HTTPS uses `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY` and `MAIL_FROM`. SMTP is an alternative where hosting permits it. School email configuration does not replace the platform service for account verification. Provider acceptance does not guarantee inbox delivery.

The owner can inspect worker heartbeat, delivery status and sanitized errors in Tenant communications. `node scripts/diagnose-email.mjs` inspects queue state and provider connectivity without dispatching queued messages. Retry controls requeue failed messages; they do not resend successfully recorded deliveries.

School fee methods include manual transfer, Paystack, Stripe, PayPal and Flutterwave when configured. SMPIS subscription checkout is separate and supports configured bank transfers, Stripe, Paystack and Flutterwave. Test payments do not activate paid access. Automatic renewal requires administrator authorization, verified live payment, a reusable payment method and a running worker. It can be disabled in Subscription. The checkout's amount, currency and billing period apply to that authorization.

Referral commissions apply to eligible first subscription payments. The portal records a due date three calendar days after approval; the owner makes and records transfers outside SMPIS. A due date does not guarantee bank settlement time.

## Access, public information and cookies

School records are scoped by school and account permissions. School administrators and parents in the same school can use private messaging; other staff roles and platform operators cannot enter this messenger. Conversations refresh every second while visible. Online status depends on session heartbeats and expires after 45 seconds without a heartbeat. School updates also arrive in private conversations so parents can reply.

The operator-provided public details are **Cyberlife Digital** and **cyberlifeng@gmail.com**. They are the defaults in the public legal configuration. Update site legal settings or `LEGAL_ORGANIZATION_NAME` and `PRIVACY_CONTACT_EMAIL` if the operator changes. Review public policies whenever providers, data uses, billing or retention practices change. Operational retention, lawful requests and cross-border safeguards require operator decisions; policy text does not establish legal compliance.

Application code creates only the required `smpis_session` cookie after sign-in: eight-hour lifetime, HttpOnly, SameSite=Strict and Secure in production. The cookie information notice has no persistence cookie; the retired `smpis_cookie_preferences` cookie is removed when the app opens. There are no application advertising or website-usage analytics cookies and no application localStorage/sessionStorage use. When configured, reCAPTCHA loads from `recaptcha.net` only on protected form submission and may set its provider-managed security cookie. It is not loaded on the landing page. Hosting protection and external payment pages can have separate provider cookies.

## Backup and recovery

Configure a separate `BACKUP_ENCRYPTION_KEY` and access-controlled `BACKUP_OUTPUT_ROOT`, preferably outside the checkout. Keep the recovery key separately from backup files. `npm run backup` creates authenticated encrypted database and referenced-document files plus a completion manifest. An incomplete backup is not a recovery point. Backups do not include environment secrets or external provider state, and a command existing does not mean backups run automatically.

For an isolated recovery drill, check the completion manifest and ciphertext checksums, then decrypt each required file with:

```powershell
node scripts/decrypt-backup.js input.enc NEW-output-file
```

The helper refuses overwrite and authentication failures. Restore the database to an isolated Supabase project, restore referenced document objects using the decrypted object map, and configure the original application encryption keys and private bucket. Test access and document bytes before treating recovery as usable. Record the recovery result and remove temporary plaintext under the operator's data-handling procedure. Never test restoration over the live database.

## Verification and repository scope

```powershell
npm run test:embedded
npm run build
node scripts/check-source-hygiene.js
```

Embedded tests use an isolated PGlite database. Alternatively, set `TEST_DATABASE_URL` to a separate PostgreSQL test database; tests never default to application `DATABASE_URL`. `npm run check:seo` checks public routes against the configured site, or run `node scripts/check-seo.mjs http://127.0.0.1:3000` against a local server.

Public feature descriptions are in `server/product-catalog.js`, shared FAQs in `server/public-faq.js`, policy text in `src/pages/legal.jsx`, and policy/marketer versions in their shared modules. Keep these descriptions consistent with routes, role restrictions and provider configuration. Example screenshots use fictional data and may show older layouts.

This README is the maintained setup, deployment and recovery reference. Obsolete exported guides, promotional video deliverables and duplicate historical how-to documents have been removed. Keep application source, tests, migration SQL, operational scripts, active assets and deployment configuration. Do not delete `.env`, `data/` or `backups/` as source cleanup.
