# SMPIS

School Management, Performance and Intelligence System built with React, Express, Supabase PostgreSQL, and private Supabase Storage.

## Deploy to Vercel

1. Push this repository to GitHub and import it into Vercel using the **Express** framework preset and the repository root.
2. Add the environment variables listed in [the deployment guide](docs/VERCEL-DEPLOYMENT.md). Keep the same `INTEGRATION_ENCRYPTION_KEY` as your local `.env`.
3. Build with `npm run build:vercel`; frontend assets are built into `public`. Vercel searches the project root (`outputDirectory: "."`) for the Express entry point. These settings are already in `vercel.json`.
4. Deploy, check `/healthz`, and verify login, MFA, and document upload/download.

Before deploying schema changes, run locally with your private Supabase configuration:

```powershell
npm run supabase:setup
npm run supabase:check
```

## Local development

Requires Node.js 22.12 or later. Configure `.env` from `.env.example` without replacing existing credentials, then run:

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:3000 for the public SMPIS landing page. On a new installation, `/owner` creates a standalone SMPIS business owner account without a school; no default accounts are supplied. Existing owner accounts retain platform access. Schools register at `/signup` and get portals such as `/greenfield-academy/`. See [SaaS setup and payments](docs/SAAS.md).

For local background jobs, start `npm run worker` in a second terminal. For production, deploy the worker separately on Railway; see [Railway worker setup](docs/RAILWAY-WORKER.md).

## Administration

Super admins manage school-specific SMTP, Paystack, Flutterwave, and Twilio credentials in **Administration > Integrations**. Secrets are encrypted and hidden after saving. SMTP and Paystack power the existing email and payment workflows. Flutterwave checkout and Twilio SMS delivery are not implemented.


## Verification

```powershell
npm test
npm run build:vercel
npm run test:ui
```

Browser tests use `dist`; run `npm run build` before `npm run test:ui`. Keep `.env`, school data, backups, and the encryption key private. Database recovery and document backups must be configured separately in Supabase.

Authentication rate limits are shared through PostgreSQL and apply by IP and account. Production mode (`npm start`, `NODE_ENV=production`, or Vercel) enables Secure session cookies and requires HTTPS for browser login. Run `npm run supabase:setup` before deploying these changes to create the rate-limit table and notification claim columns.

Email workers claim each notification for five minutes before sending; overlapping workers cannot claim the same active message, and expired claims can be retried. SMTP cannot guarantee exactly-once delivery if a worker stops after the provider accepts a message but before its sent status is saved. Password reset requests return the same public response for unknown accounts, missing school SMTP settings, and delivery failures; delivery failures are logged on the server.

## Legal pages and cookies

Public HTML includes a meta description, canonical link, Open Graph metadata, JSON-LD and a visible heading before JavaScript loads. Set `APP_URL` to the public HTTPS site origin before building and deploying so canonical links identify the correct site. Vercel can also use `VERCEL_PROJECT_PRODUCTION_URL` when `APP_URL` is unset. Rebuild after changing this URL: the static homepage metadata is generated during the Vite build. Policy pages receive their own metadata from Express.

Terms, Privacy, and Cookies are public at `/terms`, `/privacy`, and `/cookies`. Super admins publish the operator name and privacy email in Administration > Site settings. The notice inventories the actual application cookies: `smpis_session` (8-hour, HttpOnly login session) and `smpis_cookie_preferences` (365-day notice preference, created on acceptance). No application analytics or advertising cookies are configured. The notice can be dismissed without saving a preference.

## Local database selection


Run `npm run build:vercel` followed by `node tests/site-browser.mjs` to verify public policy pages, cookie preferences, published legal contacts in Chrome against an isolated test database.

Supabase is the only database for development and deployment. Integration and browser tests require a separate PostgreSQL `TEST_DATABASE_URL`; each run creates and removes its own isolated schema. Without this variable, `npm test` runs the standalone checks and explicitly skips database integration tests. Tests never use your application `DATABASE_URL`.

New owner and school registrations require email verification. Set APP_URL, SMTP_URL, and MAIL_FROM on the server before accepting signups. Verification links expire after 24 hours; users can request another link on /login. Existing accounts remain verified. MFA enrollment is optional; accounts that enable it still verify at login. Free trials last 30 days, including existing 14-day trials extended by 16 days without resetting their start date. Owners can open any school portal from the Schools list and work with super administrator permissions; audit entries retain the owner user ID.

The school Support menu routes requests to Sales or Technical. The owner console's Customer Support section sees both departments. Console Team creates delegated Sales, Technical, or Schools and Subscriptions accounts; these accounts verify their email and sign in at /owner, and cannot open tenant dashboards or manage team permissions. Schools and Subscriptions lists subscription metadata and supports suspension/restoration without exposing tenant records or payment credentials.

School administrators can pause or resume access from Subscription, confirming their password. Pausing does not extend expiry or preserve unused time. Account deletion requests immediately suspend operations, retain administrator Support access for three calendar months, and then block all school sign-in. The worker finalizes closure and revokes sessions; login and existing sessions also check the deadline directly, so access closes even if the worker is delayed. School records, audit history and email addresses remain stored. Full owners can reactivate closed or pending-deletion schools under Schools and Subscriptions, without granting a new trial. Run npm run supabase:setup to apply these additions on deployed databases.

Tenant registration requires an administrator phone number (7?15 digits, with optional country-code prefix and common separators). Existing account phone numbers remain blank until collected. Full owners can export administrator emails and phone numbers from Tenant communications and send a message to one, several, or all eligible schools. Each administrator has a private SMPIS inbox. Support submissions alert full owners and staff assigned to the matching department; replies alert the requester. A visible signed-in page sends a presence heartbeat every 30 seconds. The worker emails unread messages when no verified session has been active for two minutes; reading a message prevents pending email delivery. Email delivery uses platform SMTP, retries failures up to five attempts, and claims messages to prevent overlapping workers from sending the same active message. Run npm run worker continuously (or schedule the existing background job) to deliver email notifications; without a worker, inbox messages still appear but email stays queued. Apply the schema additions with npm run supabase:setup before deployment.

Full owners can set Monthly Pro price (USD) and Yearly Pro price (USD) under Payment settings. The global exchange rate converts these base prices into the chosen display and payment currency. New quotes, signup pricing, billing and reminders use the saved prices; previously created payment quotes and recorded revenue retain their original amounts. Yearly savings are calculated from the actual monthly and yearly prices. Pricing changes do not extend or shorten existing subscriptions.

Customer support exposes Reply / manage ticket for full owners and matching departmental staff. Replies retain author and timestamp history and alert the requester in their inbox or through offline email delivery. A status-only update preserves previous replies. Existing responses are migrated into reply history. Mark all as read clears every unread notification for the signed-in owner, delegated staff member or tenant, including messages beyond the 100-item inbox display; queued unread-email delivery stops for those messages.

Full owners manage plain-text platform email templates under Email templates: verification, password reset, tenant announcements, support replies, inbound support-ticket alerts and subscription reminders. Supported placeholders are shown in the editor; required links and notification bodies cannot be removed. Changes are audited and apply to subsequent deliveries, including queued messages. Inbound alerts are emails to the owner and matching support department about portal submissions; this does not provide an external email inbox or ingest replies sent to MAIL_FROM. Apply the new tables and columns with npm run supabase:setup, restart or redeploy, and keep npm run worker running for queued email delivery.

Signup email screening uses the server-side StopReg API. Set STOPREG_API_TOKEN in .env locally and in the hosting environment to enable it, then restart or redeploy. Without a token, signup retains the existing email-verification flow. See https://stopreg.com/documentation for the API endpoint and response contract. Disposable addresses, blocklisted addresses/domains, and policy actions warn or block are rejected with a clear registration message before records are created or verification mail is sent. Public, school, role-based, relay and alias addresses are accepted when StopReg allows them and they are not disposable or blocklisted. Configured screening fails closed on timeouts, quota exhaustion, invalid credentials or malformed responses, with a temporary retry message. Existing sign-in is unaffected. The API token and raw provider errors are never sent to the browser. No database migration is needed for this integration.
