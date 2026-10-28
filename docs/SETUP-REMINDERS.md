# School setup reminder emails

Apply the schema with `npm run supabase:setup` before deploying the updated app
and worker. Keep the background worker (`npm run worker`) running and configure
the platform email provider and public `APP_URL` as for other service emails.

The worker discovers both new and existing tenant schools. Each school gets one
persisted campaign, with its first reminder due two days after discovery. Existing
schools do not receive a backlog based on their registration date. Successful
delivery schedules the next reminder two days later, up to ten emails. Worker
downtime does not cause a burst of catch-up messages.

Each reminder uses different copy, reads the seven current dashboard setup checks,
shows complete and unfinished steps, and links to the first unfinished step.
Payment readiness uses the same method configuration as the fee payment screen;
fee structures and classes are checked against the current term and academic year.

One active, verified SUPER_ADMIN (the earliest account) receives each school's
email. Campaign state belongs to the school, so changing administrators does not
reset the count. Active trials and subscriptions with current access qualify;
platform operator schools, paused, expired, closed, terminated and deletion-requested
schools do not receive these emails. Inactive and unverified recipients are skipped.

Completion is checked again before delivery. Once all seven steps are complete,
the campaign is marked complete permanently. Ordinary later changes to a term
do not restart a completed initial setup campaign.

Overlapping worker runs use a five-minute claim. Missing email configuration leaves
the campaign pending. Delivery errors retry after five minutes, up to five attempts
for the current message; successful delivery clears attempts. No failed send advances
the ten-message count. Diagnostics are in `tenant_setup_reminders.last_error`.
After fixing a permanently failing delivery, an operator can reset `attempts` to zero
and set `next_send_at=now()` for the affected school to retry. As with the existing
email queues, a process crash after SMTP acceptance but before saving success can
result in a duplicate; SMTP delivery and the database update are not atomic.
