# Email delivery diagnosis and recovery

## Confirmed finding, 23 October 2026

A read-only check of the configured database found seven platform notifications and two school notifications pending, all with zero attempts. SMTP authentication from the development environment succeeded without sending a message. The operator confirmed Railway was running and logging completed job runs, but one or both of `SMTP_URL` and `MAIL_FROM` were missing from the Railway worker's environment. The previous code silently skipped notification delivery when either variable was missing. After the operator added the variables and redeployed, delivery attempts appeared but failed; no messages had been confirmed sent at the last check.

The operator also confirmed the Railway plan is Free, Trial or Hobby. [Railway's outbound networking documentation](https://docs.railway.com/networking/outbound-networking) states that these plans disable outbound SMTP. This is a second blocker: adding SMTP credentials alone cannot restore email on those plans. Use an HTTPS email service or upgrade to Railway Pro or above and redeploy for SMTP access.

Railway and Vercel have separate environments. Copy the exact working platform `SMTP_URL` and `MAIL_FROM` values into the worker service's Variables tab, verify it uses the same `DATABASE_URL`, then redeploy the worker. Do not post SMTP credentials in tickets or chat. No live queued messages were dispatched by the diagnostic script.

## Source changes

- Ordinary platform announcements, support updates and newsletters are eligible for email even if the recipient is online or has read the portal message. Existing active/verified account checks, newsletter consent, school closure checks and message claims remain enforced. MFA reminders retain their unread/offline conditions and stop when MFA is enabled.
- Background tasks run independently. A cleanup, billing or school-alert task failure is recorded but does not prevent the email tasks from running.
- SMTP rejections count as failures; transports close after each delivery. Delivery failures retain diagnostic codes without storing SMTP credentials or raw provider response text.
- The worker records a heartbeat every 30 seconds and explicitly logs whether its own SMTP variables are configured. Startup refuses an outdated delivery schema before it can send messages.
- Full owners can inspect Email delivery and worker status under Tenant communications, including worker/web SMTP availability, heartbeat, task errors, queue counts and recent delivery failures. Retry failed emails requeues only failed records, records an audit event and leaves sent messages untouched.

## Deploying these changes

Apply `npm run supabase:setup`, then `npm run supabase:check`, before deploying the updated Vercel app and Railway worker together. The migration adds failure diagnostics and the protected `background_worker_status` table. Keep the existing encryption keys.

After deployment, expect `Worker platform SMTP is configured.` and completed job cycles. Owner > Tenant communications should report a current heartbeat and worker SMTP configured. Pending messages should move to SENT after the next eligible run; if they fail, inspect the diagnostic codes and Railway logs. SENT means SMTP accepted the message, not that the recipient's inbox placement is guaranteed.

For a read-only local check against the configured environment, run `node scripts/diagnose-email.mjs`. This reads aggregate queue state and verifies SMTP connectivity/authentication. It does not run billing jobs, change message status or send mail.
