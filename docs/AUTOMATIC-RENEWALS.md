# Automatic subscription renewals

Only the tenant administrator authorizes or disables automatic renewal. The
Subscription page has an unchecked authorization checkbox at card checkout.
After successful server-side verification of a live payment, SMPIS stores the
provider's reusable authorization/token (encrypted with
`INTEGRATION_ENCRYPTION_KEY`). It does not store a card number or CVV. Old
payments and bank transfers do not authorize future debits.

The authorized amount, currency and monthly/yearly cycle are taken from that
payment and retained until a later authorized checkout replaces them. Updating
the owner's price or exchange rate does not silently increase an existing
authorization. Tenants can turn off renewal without pausing their subscription.
An already submitted payment may still complete after revocation.

## Worker and retries

Run the existing `npm run worker` process continuously. Its minute-by-minute
job checks for expired Pro subscriptions, then attempts the authorized renewal.
Confirmed failures can be retried every 12 hours until the configured grace
deadline. Zero grace permits only an initial attempt, within 12 hours of expiry.
There are no new debits after grace, during manual suspension, after account
deletion, or for owner workspaces or Free trials.

Claims and transaction locks prevent overlapping workers from starting the same
attempt. Stripe PaymentIntent IDs are stored before confirmation. After an
ambiguous Paystack/Flutterwave response, the worker verifies the original
reference instead of resending a charge. Unresolved payments block further
automatic debits and manual checkout until reconciled; they may need Support
and provider investigation if the provider never resolves the reference.
Pending manual payments less than 24 hours old defer a new automatic attempt.
An automatic payment settling after a different renewal is held for owner review
instead of extending access twice. As with other payments, owners must resolve
payments held for review and arrange any necessary refunds with the provider.

Stripe and Paystack use their off-session card/payment authorization APIs.
Flutterwave uses tokenized charges. Flutterwave accounts require NOAUTH approval
for fully unattended renewals; otherwise the provider may require customer
authentication. When it returns an authentication link, Subscription displays
"Authorize renewal payment" while the worker checks the same transaction.

Only verified success extends subscription access. Existing expiry/grace and
suspension rules still apply if renewal fails. Provider calls are never made
with sandbox credentials by the renewal worker.

## Failure emails

An attempt's failure or unresolved result queues one service email per active
tenant administrator through the existing notification outbox and platform
SMTP. Delivery has its existing claims, deduplication and retry behavior.
Emails link directly to the tenant's Subscription page and explain how to pay
or update their card. Unknown results are described as unconfirmed, not as a
definite decline. Repeated polling does not create repeated emails for the same
attempt.

The owner can edit the subject and message under Email templates → Automatic
renewal payment issue. Content uses the existing branded HTML renderer with a
plain-text fallback and a "Review your subscription" action. Its variables are
`title`, `body` and `link`.

## Deployment and verification

Apply `npm run supabase:setup` before deploying both app and worker. This adds
the payment/authorization fields and the RLS-protected
`subscription_auto_renewals` table. Keep the existing integration encryption
key and configure platform SMTP, `APP_URL`, live provider keys and webhooks.
The migration does not enroll existing tenants or issue any payments.

Provider API references:

- https://docs.stripe.com/payments/save-during-payment
- https://paystack.com/docs/payments/recurring-charges/
- https://developer.flutterwave.com/docs/tokenization

Verification commands (isolated embedded database; provider requests mocked):

```powershell
node scripts/test-embedded.mjs --test tests/recurring-payments.test.js tests/saas.test.js tests/permissions.test.js tests/branded-email.test.js tests/support-email-templates.test.js
npm run build
node scripts/test-embedded.mjs tests/recurring-payments-browser.mjs
```
