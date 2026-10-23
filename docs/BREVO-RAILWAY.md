# Connect the Railway worker to the existing Brevo account

Use Brevo's HTTPS API instead of SMTP on Railway Free, Trial or Hobby. Keep the existing Brevo account and verified `SMPIS <do-not-reply@smpis.digital>` sender.

## Private variables on the Railway worker

```dotenv
EMAIL_PROVIDER=brevo
BREVO_API_KEY=YOUR_PRIVATE_BREVO_API_KEY
MAIL_FROM="SMPIS <do-not-reply@smpis.digital>"
APP_URL=https://smpis.digital
```

In Railway's variable editor, enter actual values without the surrounding dotenv quotes. `BREVO_API_KEY` must be a Brevo API key, not the SMTP key. The existing `SMTP_URL` can remain stored; it is not used when `EMAIL_PROVIDER=brevo`. Keep the existing database, Supabase and encryption variables unchanged. Never put the API key in a `VITE_` variable, commit it, or paste it into chat.

Create a key in the existing Brevo account under Settings > SMTP & API > API Keys & MCP. Name it for the SMPIS Railway worker, copy it immediately and save it privately. Brevo only shows the complete key when it is created. If account IP restrictions are enabled, authorize the Railway worker's requests through Brevo's security controls.

Official instructions: [API key creation](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys), [API authentication](https://developers.brevo.com/docs/api-key-authentication), [transactional email endpoint](https://developers.brevo.com/reference/send-transac-email).

## Rollout

1. Apply the current schema using `npm run supabase:setup`, then `npm run supabase:check`. This includes the worker delivery diagnostics and provider-status column.
2. Deploy the updated application to Vercel. The public `/email-logo.png` endpoint serves the official logo used in Brevo emails. The Vercel application can keep its existing SMTP configuration, or use the same Brevo HTTPS variables if desired.
3. Add the private variables above to the Railway worker and deploy the updated source. Keep its start command as `npm run worker`.
4. Check logs for `Worker email provider: brevo; configured.` Check Owner > Tenant communications for the worker heartbeat, provider and queue counts.
5. Use Retry failed emails in that owner panel to requeue records exhausted during the earlier SMTP failures. Already-sent messages are not requeued. The existing claim and retry protections still apply.

For local authentication verification, privately add the Brevo variables to `.env` and run `node scripts/diagnose-email.mjs`. The script checks the selected provider with Brevo's read-only account endpoint and does not send messages.

## Behavior

All existing Nodemailer email flows use the HTTPS adapter when selected: tenant/owner notifications, school alerts, onboarding, verification, password recovery and account activation. Brevo receives the existing subject, HTML and plain-text content. SMTP remains the default when `EMAIL_PROVIDER` is unset. A missing Brevo key never triggers an SMTP fallback.

The Brevo API does not expose inline attachment Content-ID support. The official email logo therefore uses the public HTTPS image URL; other attachments with buffer content are sent as base64 attachments. Existing unsubscribe links remain in the HTML/text message body.

HTTP errors, malformed API responses and timeouts fail delivery rather than marking a message sent. Error diagnostics include only HTTP/code metadata, not API keys or provider response bodies. SENT confirms provider acceptance, not recipient inbox placement. Existing queue claims prevent overlapping workers from claiming the same active message; network failures after provider acceptance can still cause a retry duplicate, as with SMTP.

## Email branding

The production build emits `/email-logo.png` as a public PNG for the official SMPIS logo. It must return `Content-Type: image/png`, rather than the application HTML. Deploy both the web application and Railway worker after branding changes.

Emails for school accounts include that school's current name and uploaded logo, in addition to SMPIS branding. This covers school notices, fee reminders, onboarding, activation, verification, password reset and platform notices delivered to a school account. Schools without an uploaded logo still display their name. SMTP embeds the logos; Brevo uses public HTTPS image URLs, including `/email-school-logo/{portal_slug}`. This endpoint serves only the school's public branding image, without account or school records.

Previously sent email HTML is not rewritten. Check branding with a newly sent email after deployment. Email clients may require recipients to enable external images.

## Public links and message footer

Set `APP_URL=https://smpis.digital` on both the web application and Railway worker. The email renderer also replaces the retired `smpis.vercel.app` host and the `www.smpis.digital` alias with `https://smpis.digital`, preserving portal paths, fragments, activation tokens and unsubscribe signatures. This includes links in queued notification bodies and saved templates.

The shared HTML and plain-text footer identifies the account recipient, explains why the message was sent, and links to `info@smpis.digital` and `/privacy`. Messages without an account name use the recipient email when available. Newsletter consent/unsubscribe text remains separate from essential account and school messages.

## Support notifications still have old links, footer or logo

Support-ticket notifications are rendered and sent by the Railway worker, not by the browser or Vercel frontend. Deploying Vercel alone does not update them. In Railway, deploy the latest source commit from the same repository/branch as the web app; simply restarting an older deployment keeps the old templates.

Set `APP_URL=https://smpis.digital` in the worker variables. Its updated startup logs must include:

```text
Worker email templates: 2026-10-23-branding-footer-v1.
Worker public email origin: https://smpis.digital.
Worker email provider: brevo; configured.
```

After confirming those lines, create a new support ticket or reply to an existing ticket and inspect its new email. Do not retry already-sent messages. The retired `https://smpis.vercel.app/email-logo.png` returns 404; the public domain's `/email-logo.png` serves the official PNG. Email clients can still require recipients to enable external images.
