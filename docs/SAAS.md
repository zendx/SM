# SMPIS school subscriptions

The public homepage sells SMPIS; `/signup` registers a school, `/login` provides common sign-in, `/owner` provides initial owner setup and sign-in, and `/<portal-name>/` provides each school’s portal. These are application routes: no duplicate code or physical folders are needed. The existing school ID boundaries, record permissions and private document storage remain in use. School accounts presented at the wrong portal are rejected. Owners can select a school using its portal URL; school requests use that school context while audits retain the owner identity.

## Installation and migration

Run `npm run supabase:setup` before deploying and then `npm run supabase:check`. Development startup also initializes schema. The migration adds portal names and subscription tables without deleting school records. Existing portals are named `/school-<lowercase-school-code>/`; existing tenant schools receive a 30-day transition trial when the migration first runs. Re-running schema setup does not restart that trial. The owner workspace is exempt from subscription expiry and cannot be suspended or terminated from the owner dashboard.

On a fresh installation, visit `/owner` and register with your name, email and password. This creates a standalone `PLATFORM_OWNER` account with no school, academic year or school subscription. Public school registration stays closed until owner setup is complete. Verify the registration email before signing in. MFA enrollment is optional. Existing designated owner credentials continue to work in this dedicated console; historical school records are preserved. No demo account or default password is installed.

## Owner business console

Under **Account security**, owners can change their name, email and password by confirming their current password. Leave the new password blank to keep it. Changes revoke other sessions and invalidate outstanding reset links. New passwords require at least 12 characters. MFA enrollment is optional; enabled authenticators remain required at login.

The `/owner` console has its own navigation and loads business data without school configuration. Business overview shows registered schools, individual customer accounts, schools that have paid, confirmed subscription receipts, receipts this month and pending bank payments. The interactive six-month chart switches between revenue and customer signups. Legacy owner schools are excluded from customer metrics.

**Customer accounts** searches names, emails and schools. The owner can edit basic account details, roles and status, revoke sessions, create a one-time password recovery link or reset an authenticator after verifying identity. Every action requires a reason and records an audit event; account changes revoke existing sessions. The last active school administrator cannot be demoted or suspended. Recovery links expire after 30 minutes, are stored as hashes and are never written to audit logs. Share recovery links securely with the verified account holder.

**Customer support** lists issues submitted by school administrators from their subscription screen, which stays accessible during subscription suspension. Mark issues open, in progress or resolved and provide a response visible to the school. Resolved issues require a resolution. Owners can open school portals from the Schools list with super administrator permissions. School accounts cannot sign into the owner console.

The public landing page uses viewport reveals, eased hover transitions and a subtle pointer response on the dashboard preview. Reduced-motion preferences disable animation and keep all content visible.

## Plans and access

* Free is a single 30-day trial with all existing modules. No card is required and no automatic trial conversion occurs.
* Pro monthly is USD 100, stored as 10,000 cents.
* Pro yearly is USD 1,020, stored as 102,000 cents: USD 1,200 less 15%.
* Paid periods use calendar months or years. Renewing before expiry adds the next period after the existing expiry. Renewing after expiry starts a new period at verified payment time.
* Card checkout buys one period. It does **not** establish recurring card debits. Administrators renew each period using card checkout or bank transfer.
* Free expires precisely at its access expiry, without grace. Pro uses the owner’s configured grace period, initially zero days. Suspension blocks school operations for existing sessions as well as new logins. Billing, logout and administrator security setup remain available.
* Owner suspension is distinct from overdue suspension. Payments cannot remove a manual suspension. Incoming funds for a portal suspended manually or terminated are marked **REVIEW**, counted as actual receipts, and held for owner reconciliation; no access is granted. Pro restoration may explicitly grant future access, with a recorded reason, without creating revenue. Free restoration cannot extend the original 30-day trial; restoring an expired Free subscription removes the manual hold so the school can pay for Pro while operational access remains paused.
* Termination disables operational access and retains records. It is deliberately not reversible from the dashboard. No record-deletion endpoint is provided.

## Owner payment settings

Under **Payment settings**, choose **Global subscription currency** (USD or NGN) and set **Global exchange rate** to the number of NGN per USD. The selection applies to public prices, signup, school subscription screens, bank transfers, Stripe, Paystack, Flutterwave and renewal reminders. The base remains $100 monthly and $1,020 yearly (15% discount). At 1,500 NGN per USD, prices are NGN 150,000 monthly or NGN 1,530,000 yearly. Card providers use the same global currency and rate; separate provider currency overrides are removed. Merchant accounts must support the chosen currency.

Every payment captures its amount and currency when created. Switching the global currency or rate affects new quotes and preserves outstanding payments, webhook verification and receipt history. Owner revenue charts and totals display the selected currency using the current rate; the payment table and CSV retain actual historical amounts and currencies. USD base equivalents are retained internally to avoid adding amounts in different currencies.

Sign in at `/owner`, open **Payment settings**, and enter the receiving bank, account name, account number, instructions and Pro grace period. Empty bank details disable transfer submission. Bank payments are quoted in USD or NGN. For NGN, set the business exchange rate in naira per USD; the school sees the payable amount before submitting a transfer reference. Review the captured payable amount against the actual bank receipt before approval.

Each payment row captures its USD price, billing period, payable currency and amount. Revenue shows the selected-currency equivalent of verified live receipts, and lists the actual captured payment amounts separately. It is not net revenue after processor charges, a foreign-exchange revaluation, student fee revenue, or accounting profit. Monthly totals use the database calendar month. Pending, rejected and sandbox payments are excluded. Per-school receipt totals appear in the tenant table. Owner CSV exports include the complete payment ledger and audit history; the dashboard lists the latest 250 payment and audit rows. CSV text is escaped to prevent spreadsheet formulas from being interpreted.

The owner may enable Stripe, Paystack and Flutterwave independently. Configurations are stored in a separate `saas_payment_providers` table using AES-256-GCM encryption and distinct associated data; schools cannot read or change them. Preserve `INTEGRATION_ENCRYPTION_KEY` across deployment and recovery. Secret values are never returned to the browser or written to the audit trail. Leave a saved secret blank to preserve it; remove credentials with the explicit checkbox.

Providers default to **Sandbox**, disabled, without fabricated credentials. Enter real test keys from your provider dashboard. Stripe and Paystack test keys begin with `sk_test_`; Flutterwave v3 test secret keys contain `_TEST`. Add the webhook secret/hash and enable the provider. The owner can later select **Live** and enter matching live credentials. The API rejects a key whose mode does not match the selection. Provider account approval and enabled merchant currencies are required for live payment acceptance.

Stripe, Paystack and Flutterwave charge the selected global currency. Test payments show **TEST_CONFIRMED**, create no live revenue and do not extend access. Payment verification checks the captured amount and currency rather than current pricing settings.

Configure provider webhooks at your actual HTTPS domain:

| Provider | Endpoint | Configuration |
| --- | --- | --- |
| Stripe | `/api/v1/saas/webhooks/stripe` | Signing secret from webhook endpoint; subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded` |
| Paystack | `/api/v1/saas/webhooks/paystack` | Dashboard webhook URL; signatures use the matching Paystack secret key |
| Flutterwave v3 | `/api/v1/saas/webhooks/flutterwave` | Dashboard webhook URL and secret hash; use `charge.completed` |

Successful redirects alone do not grant access. Stripe and Paystack webhook signatures are checked against the exact raw request body; Flutterwave v3 checks `verif-hash`. Transactions are then retrieved from the provider and checked against the recorded reference, tenant, currency, amount and mode. Database payment locks make repeated callbacks and simultaneous approval safe against duplicate subscription credits. Bank-transfer references cannot be reused within the same school, except after rejection. Keep old outstanding payments reconciled before replacing keys or switching payment mode.

Implementation references: [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signatures), [Paystack transactions](https://paystack.com/docs/api/transaction/), [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [Flutterwave Standard](https://developer.flutterwave.com/docs/flutterwave-standard-1), [Flutterwave v3 webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks).

## Expiry and notifications

The separate application worker runs every minute; deploy it on Railway as described in [the worker guide](RAILWAY-WORKER.md). Expiry is also enforced on operational API requests, so a delayed worker cannot grant overdue access. Reminders are queued seven, three and one day before expiry, plus an expiry notice, using database dedupe keys. Delivery uses the existing school SMTP configuration or server email fallback; configure these to send actual reminders. The owner dashboard audits expiry, payments, configuration and owner subscription actions. No unsolicited email is sent during isolated tests.

## Verification

`npm run test:embedded` runs the full test suite against fresh in-memory PGlite PostgreSQL instances and never uses the application database. It is a portable functional regression check, not a substitute for load or multi-connection testing against production PostgreSQL. `TEST_DATABASE_URL` remains available for tests using a separate real PostgreSQL database.

Run `npm run build` then `npm run test:ui:saas` for the Chrome browser workflow: desktop/mobile marketing, yearly pricing, owner provider configuration, self signup, trial expiry, manual payment approval, suspension and restoration. Browser screenshots are written to `test-results/smpis-*.png`. No real card transaction is made and provider responses in API tests are simulated. Verify actual provider sandbox checkouts after supplying your test credentials.


## Vercel website, Railway worker and custom domain

The production origin is `https://smpis.digital`. Set `APP_URL=https://smpis.digital` in both Vercel and Railway, then redeploy the website so canonical links, callbacks and recovery links use the domain. Attach the domain to the Vercel project and follow the DNS records Vercel reports. Provider webhook URLs use the endpoints above under `https://smpis.digital`. These dashboard settings cannot be changed by editing the local `.env` alone.

The repository's `worker/index.js` runs jobs sequentially every minute and closes its database connection on SIGTERM. Deploy it as a persistent Railway service with start command `npm run worker`, one replica, and no public domain or HTTP healthcheck. The included `railway.json` sets that start command. It is a continuously running worker, so do not also configure it as a Railway cron job. The Vercel entry point (`index.js`) serves requests without a background timer. The local web server (`server/index.js`) also leaves jobs to the worker. Avoid a second scheduled caller for `/api/cron` when Railway already runs the jobs.

Use the same Supabase database, storage settings, database TLS certificate, integration encryption key and public `APP_URL` on both services. Configure SMTP on the worker if email delivery is needed; without it, notifications remain queued. Apply schema migrations with `npm run supabase:setup` before deploying worker changes. The worker intentionally does not run schema migrations. Review Railway logs for completed runs and failures.

References: [Railway services](https://docs.railway.com/services), [Railway cron jobs](https://docs.railway.com/cron-jobs), [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
