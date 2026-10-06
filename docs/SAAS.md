# SMPIS school subscriptions

The public homepage sells SMPIS; `/signup` registers a school, `/login` provides common sign-in, `/owner` provides initial owner setup and sign-in, and `/<portal-name>/` provides each school’s portal. These are application routes: no duplicate code or physical folders are needed. The existing school ID boundaries, record permissions and private document storage remain in use. An account presented at the wrong portal is rejected. Removing a portal header never changes the authenticated school ID.

## Installation and migration

Run `npm run supabase:setup` before deploying and then `npm run supabase:check`. Development startup also initializes schema. The migration adds portal names and subscription tables without deleting school records. Existing portals are named `/school-<lowercase-school-code>/`; existing tenant schools receive a 14-day transition trial when the migration first runs. Re-running schema setup does not restart that trial. The owner workspace is exempt from subscription expiry and cannot be suspended or terminated from the owner dashboard.

On a fresh installation, visit `/owner` and register with your name, email and password. This creates a standalone `PLATFORM_OWNER` account with no school, academic year or school subscription. Public school registration stays closed until owner setup is complete. Complete owner MFA setup when prompted. Existing designated owner credentials continue to work in this dedicated console; historical school records are preserved. No demo account or default password is installed.

## Owner business console

Under **Account security**, owners can change their name, email and password by confirming their current password. Leave the new password blank to keep it. Changes revoke other sessions and invalidate outstanding reset links. New passwords require at least 12 characters. Complete mandatory MFA setup before editing credentials.

The `/owner` console has its own navigation and loads business data without school configuration. Business overview shows registered schools, individual customer accounts, schools that have paid, confirmed subscription receipts, receipts this month and pending bank payments. The interactive six-month chart switches between revenue and customer signups. Legacy owner schools are excluded from customer metrics.

**Customer accounts** searches names, emails and schools. The owner can edit basic account details, roles and status, revoke sessions, create a one-time password recovery link or reset an authenticator after verifying identity. Every action requires a reason and records an audit event; account changes revoke existing sessions. The last active school administrator cannot be demoted or suspended. Recovery links expire after 30 minutes, are stored as hashes and are never written to audit logs. Share recovery links securely with the verified account holder.

**Customer support** lists issues submitted by school administrators from their subscription screen, which stays accessible during subscription suspension. Mark issues open, in progress or resolved and provide a response visible to the school. Resolved issues require a resolution. Standalone owners cannot use school administration APIs; school accounts cannot sign into the owner console.

The public landing page uses viewport reveals, eased hover transitions and a subtle pointer response on the dashboard preview. Reduced-motion preferences disable animation and keep all content visible.

## Plans and access

* Free is a single 14-day trial with all existing modules. No card is required and no automatic trial conversion occurs.
* Pro monthly is USD 100, stored as 10,000 cents.
* Pro yearly is USD 1,020, stored as 102,000 cents: USD 1,200 less 15%.
* Paid periods use calendar months or years. Renewing before expiry adds the next period after the existing expiry. Renewing after expiry starts a new period at verified payment time.
* Card checkout buys one period. It does **not** establish recurring card debits. Administrators renew each period using card checkout or bank transfer.
* Free expires precisely at its access expiry, without grace. Pro uses the owner’s configured grace period, initially zero days. Suspension blocks school operations for existing sessions as well as new logins. Billing, logout and administrator security setup remain available.
* Owner suspension is distinct from overdue suspension. Payments cannot remove a manual suspension. Incoming funds for a portal suspended manually or terminated are marked **REVIEW**, counted as actual receipts, and held for owner reconciliation; no access is granted. Pro restoration may explicitly grant future access, with a recorded reason, without creating revenue. Free restoration cannot extend the original 14-day trial; restoring an expired Free subscription removes the manual hold so the school can pay for Pro while operational access remains paused.
* Termination disables operational access and retains records. It is deliberately not reversible from the dashboard. No record-deletion endpoint is provided.

## Owner payment settings

Under **Payment settings**, choose **Landing page pricing currency** (USD or NGN) and set **Public pricing exchange rate** to the number of NGN per USD. Public monthly prices, yearly prices, savings and the yearly-discount FAQ use that selection. USD base prices remain $100 monthly and $1,020 yearly. This display rate is separate from the actual bank or card-provider rates; the payment method confirms the final payable amount before checkout.

Sign in at `/owner`, open **Payment settings**, and enter the receiving bank, account name, account number, currency, instructions and Pro grace period. Empty bank details disable transfer submission. Bank payments are quoted in USD or NGN. For NGN, set the business exchange rate in naira per USD; the school sees the payable amount before submitting a transfer reference. Review the captured payable amount against the actual bank receipt before approval.

Each payment row captures its USD price, billing period, payable currency and amount. Revenue shows the USD subscription-price equivalent of verified live receipts, and lists the actual captured payment amounts separately. It is not net revenue after processor charges, a foreign-exchange revaluation, student fee revenue, or accounting profit. Monthly totals use the database calendar month. Pending, rejected and sandbox payments are excluded. Per-school receipt totals appear in the tenant table. Owner CSV exports include the complete payment ledger and audit history; the dashboard lists the latest 250 payment and audit rows. CSV text is escaped to prevent spreadsheet formulas from being interpreted.

The owner may enable Stripe, Paystack and Flutterwave independently. Configurations are stored in a separate `saas_payment_providers` table using AES-256-GCM encryption and distinct associated data; schools cannot read or change them. Preserve `INTEGRATION_ENCRYPTION_KEY` across deployment and recovery. Secret values are never returned to the browser or written to the audit trail. Leave a saved secret blank to preserve it; remove credentials with the explicit checkbox.

Providers default to **Sandbox**, disabled, without fabricated credentials. Enter real test keys from your provider dashboard. Stripe and Paystack test keys begin with `sk_test_`; Flutterwave v3 test secret keys contain `_TEST`. Add the webhook secret/hash and enable the provider. The owner can later select **Live** and enter matching live credentials. The API rejects a key whose mode does not match the selection. Provider account approval and enabled merchant currencies are required for live payment acceptance.

Stripe charges in USD. Paystack and Flutterwave can charge in NGN at an owner-configured rate, or USD if enabled on the merchant account. School fee currencies do not change SMPIS prices. Test payments show **TEST_CONFIRMED**, create no live revenue and do not extend access. You can test full paid access locally through the isolated browser suite, or explicitly grant test access through owner restoration.

Configure provider webhooks at your actual HTTPS domain:

| Provider | Endpoint | Configuration |
| --- | --- | --- |
| Stripe | `/api/v1/saas/webhooks/stripe` | Signing secret from webhook endpoint; subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded` |
| Paystack | `/api/v1/saas/webhooks/paystack` | Dashboard webhook URL; signatures use the matching Paystack secret key |
| Flutterwave v3 | `/api/v1/saas/webhooks/flutterwave` | Dashboard webhook URL and secret hash; use `charge.completed` |

Successful redirects alone do not grant access. Stripe and Paystack webhook signatures are checked against the exact raw request body; Flutterwave v3 checks `verif-hash`. Transactions are then retrieved from the provider and checked against the recorded reference, tenant, currency, amount and mode. Database payment locks make repeated callbacks and simultaneous approval safe against duplicate subscription credits. Bank-transfer references cannot be reused within the same school, except after rejection. Keep old outstanding payments reconciled before replacing keys or switching payment mode.

Implementation references: [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signatures), [Paystack transactions](https://paystack.com/docs/api/transaction/), [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [Flutterwave Standard](https://developer.flutterwave.com/docs/flutterwave-standard-1), [Flutterwave v3 webhooks](https://developer.flutterwave.com/v3.0.0/docs/webhooks).

## Expiry and notifications

The local application worker runs every minute. The existing Vercel cron invokes `/api/cron` daily; set `CRON_SECRET`. Expiry is also enforced on operational API requests, so a delayed cron cannot grant overdue access. Reminders are queued seven, three and one day before expiry, plus an expiry notice, using database dedupe keys. Delivery uses the existing school SMTP configuration or server email fallback; configure these to send actual reminders. The owner dashboard audits expiry, payments, configuration and owner subscription actions. No unsolicited email is sent during isolated tests.

## Verification

`npm run test:embedded` runs the full test suite against fresh in-memory PGlite PostgreSQL instances and never uses the application database. It is a portable functional regression check, not a substitute for load or multi-connection testing against production PostgreSQL. `TEST_DATABASE_URL` remains available for tests using a separate real PostgreSQL database.

Run `npm run build` then `npm run test:ui:saas` for the Chrome browser workflow: desktop/mobile marketing, yearly pricing, owner provider configuration, self signup, trial expiry, manual payment approval, suspension and restoration. Browser screenshots are written to `test-results/smpis-*.png`. No real card transaction is made and provider responses in API tests are simulated. Verify actual provider sandbox checkouts after supplying your test credentials.
