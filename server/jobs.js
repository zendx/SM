import { runAutoRenewals } from "./recurring-payments.js";
import { emailConfigurationStatus } from "./email-configuration.js";
import { deliverPlatformNotifications } from "./platform-notifications.js";
import { finalizeClosures } from "./account-lifecycle.js";
import { smtpConfig } from "./integrations.js";
import { sendEmail, emailErrorCode } from "./email-delivery.js";
import { renderEmail } from "./email-templates.js";
import { rows, one } from "./db.js";
import { refreshAlerts } from "./services.js";
import { localClock, token } from "./security.js";
import { refreshOperationAlerts } from "./operations-service.js";
import { expireSubscriptions } from "./saas-service.js";
import { queueMfaReminders } from "./mfa-reminders.js";
import { deliverSetupReminders } from "./setup-reminders.js";
import { deliverOnboardingEmails } from "./onboarding-emails.js";
import { deliverVerifications } from "./verification-delivery.js";
import { reconcileDocumentUploads } from "./document-cleanup.js";
export async function runJobs(db, overrides = {}) {
  const failures = [];
  try {
    await db.query(
      "INSERT INTO background_worker_status(id,last_seen_at,last_started_at,smtp_configured,email_provider) VALUES(1,now(),now(),$1,$2) ON CONFLICT(id) DO UPDATE SET last_seen_at=now(),last_started_at=now(),smtp_configured=$1,email_provider=$2",
      [
        emailConfigurationStatus().configured,
        emailConfigurationStatus().provider,
      ],
    );
  } catch (error) {
    console.error("Worker status unavailable:", emailErrorCode(error));
  }
  const tasks = {
    cleanup: async () => {
      await db.query(
        "DELETE FROM email_verification_tokens WHERE expires_at<=now()",
      );
      await db.query("DELETE FROM reset_tokens WHERE expires_at<=now()");
      await db.query("DELETE FROM sessions WHERE expires_at<=now()");
      await db.query("DELETE FROM auth_rate_limits WHERE reset_at<now()");
    },
    document_cleanup: () => reconcileDocumentUploads(db),
    verification_email: () => deliverVerifications(db),
    account_closures: () => finalizeClosures(db),
    automatic_renewals: () => runAutoRenewals(db),
    subscription_expiry: () => expireSubscriptions(db),
    onboarding_email: () => deliverOnboardingEmails(db),
    setup_reminders: () => deliverSetupReminders(db),
    mfa_reminders: () => queueMfaReminders(db),
    school_notices: () => generateSchoolNotifications(db),
    school_email: () => deliverNotifications(db),
    platform_email: () => deliverPlatformNotifications(db),
  };
  for (const [name, task] of Object.entries(tasks)) {
    try {
      await (overrides[name] || task)();
    } catch (error) {
      failures.push(`${name}: ${emailErrorCode(error)}`);
      console.error("Background task failed:", name, emailErrorCode(error));
    }
  }
  try {
    await db.query(
      "UPDATE background_worker_status SET last_completed_at=now(),last_error=$1,last_success_at=CASE WHEN $1='' THEN now() ELSE last_success_at END WHERE id=1",
      [failures.join("; ")],
    );
  } catch (error) {
    console.error("Worker status unavailable:", emailErrorCode(error));
  }
  if (failures.length)
    throw new Error(`Background tasks failed: ${failures.join("; ")}`);
}

async function generateSchoolNotifications(db) {
  // Database dedupe keys make reminders safe across overlapping job runners.
  await db.query(`INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key)
    SELECT s.school_id,u.id,u.email,
      CASE WHEN s.status='SUSPENDED' THEN 'SMPIS subscription access paused' ELSE 'Your SMPIS subscription expires soon' END,
      CASE WHEN s.status='SUSPENDED' THEN 'Your school subscription has expired. Sign in to your portal and open Subscription to renew. Your school records are retained.'
        ELSE 'Your SMPIS access expires on ' || to_char(s.period_end AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') || ' UTC. Open Subscription in your school portal to renew. Pro is ' || c.landing_currency || ' ' || round(c.monthly_price_cents::numeric / 100 * CASE WHEN c.landing_currency='NGN' THEN c.landing_usd_rate ELSE 1 END,2)::text || ' monthly or ' || c.landing_currency || ' ' || round(c.monthly_price_cents::numeric * 10.2 / 100 * CASE WHEN c.landing_currency='NGN' THEN c.landing_usd_rate ELSE 1 END,2)::text || ' yearly.' END,
      'saas-reminder:' || s.period_end::text || ':' || u.id::text || ':' || CASE WHEN s.status='SUSPENDED' THEN 'expired' ELSE ceil(extract(epoch FROM (s.period_end-now()))/86400)::text END
    FROM school_subscriptions s JOIN saas_settings c ON c.id=1 JOIN users u ON u.school_id=s.school_id AND u.role='SUPER_ADMIN' AND u.status='ACTIVE'
    WHERE NOT EXISTS(SELECT 1 FROM platform_operators o JOIN users a ON a.id=o.user_id WHERE a.school_id=s.school_id)
      AND ((s.status IN ('TRIAL','ACTIVE') AND ceil(extract(epoch FROM (s.period_end-now()))/86400) IN (1,3,7))
      OR (s.status='SUSPENDED' AND s.suspension_reason IN ('TRIAL_EXPIRED','OVERDUE')))
    ON CONFLICT(school_id,dedupe_key) DO NOTHING`);
  for (const school of await rows(
    db,
    "SELECT c.id,c.timezone,c.currency_code FROM schools c WHERE NOT EXISTS(SELECT 1 FROM school_subscriptions s WHERE s.school_id=c.id AND (s.deletion_requested_at IS NOT NULL OR s.suspension_reason='TENANT_PAUSED'))",
  )) {
    await refreshAlerts(db, school.id);
    await refreshOperationAlerts(db, school.id);
    const today = localClock(school.timezone).date;
    const reminderDays = (process.env.FEE_REMINDER_DAYS || "7,14,30")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const overdue = await rows(
      db,
      "SELECT i.*,s.parent_user_id,s.guardian_email FROM student_invoices i JOIN students s ON s.id=i.student_id WHERE i.school_id=$1 AND NOT i.waived AND i.total_cents>i.paid_cents AND ($2::date-i.due_date)=ANY($3::int[])",
      [school.id, today, reminderDays],
    );
    for (const i of overdue)
      await db.query(
        "INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,dedupe_key) DO NOTHING",
        [
          school.id,
          i.parent_user_id,
          i.guardian_email,
          "Overdue school fee reminder",
          `Invoice ${i.invoice_number} has ${school.currency_code} ${((Number(i.total_cents) - Number(i.paid_cents)) / 100).toFixed(2)} outstanding. Please contact the school finance office.`,
          `scheduled-reminder:${i.id}:${today}`,
        ],
      );
    const lowAttendance = await rows(
      db,
      "SELECT a.*,c.teacher_user_id FROM alerts a JOIN students s ON s.id=a.entity_id AND s.school_id=a.school_id LEFT JOIN classes c ON c.id=s.class_id WHERE a.school_id=$1 AND a.category='ATTENDANCE' AND a.status='ACTIVE'",
      [school.id],
    );
    for (const a of lowAttendance) {
      const recipients = await rows(
        db,
        "SELECT id,email FROM users WHERE school_id=$1 AND status='ACTIVE' AND (role='PRINCIPAL' OR id=$2)",
        [school.id, a.teacher_user_id],
      );
      for (const u of recipients)
        await db.query(
          "INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,dedupe_key) DO NOTHING",
          [
            school.id,
            u.id,
            u.email,
            "Student attendance needs attention",
            a.message,
            `attendance-alert:${a.id}:${u.id}:${today}`,
          ],
        );
    }
  }
}

export async function deliverNotifications(
  db,
  {
    configuration = smtpConfig,
    send = async (smtp, n) =>
      sendEmail(smtp, {
        to: n.email,
        ...(await renderEmail(
          db,
          n.dedupe_key?.startsWith("auto-renewal-issue:")
            ? "auto_renewal_failed"
            : n.dedupe_key?.startsWith("saas-reminder:")
              ? "subscription_reminder"
              : "school_notification",
          {
            recipient_id: n.user_id,
            recipient_email: n.email,
            school_id: n.school_id,
            title: n.title,
            body: n.body,
            link: process.env.APP_URL
              ? new URL(
                  `/${(await one(db, "SELECT portal_slug FROM schools WHERE id=$1", [n.school_id])).portal_slug}/#${n.dedupe_key?.startsWith("saas-reminder:") || n.dedupe_key?.startsWith("auto-renewal-issue:") ? "subscription" : "notifications"}`,
                  process.env.APP_URL,
                ).href
              : "",
          },
        )),
      }),
  } = {},
) {
  for (const candidate of await rows(
    db,
    "SELECT * FROM notifications WHERE delivery_status='PENDING' AND attempts<5 AND email<>'' AND (claimed_until IS NULL OR claimed_until<=now()) ORDER BY created_at LIMIT 50",
  )) {
    const smtp = await configuration(db, candidate.school_id);
    if (!smtp) {
      console.error(
        "School notification email is queued: the selected email provider is not configured.",
      );
      continue;
    }
    const claim = token();
    const n = await one(
      db,
      `UPDATE notifications SET claim_token=$2,claimed_until=now()+interval '5 minutes'
       WHERE id=$1 AND delivery_status='PENDING' AND attempts<5
         AND (claimed_until IS NULL OR claimed_until<=now()) RETURNING *`,
      [candidate.id, claim],
    );
    if (!n) continue;
    try {
      await send(smtp, n);
      await db.query(
        "UPDATE notifications SET delivery_status='SENT',sent_at=now(),last_error='',claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [n.id, claim],
      );
    } catch (error) {
      console.error(
        "School notification delivery failed:",
        n.id,
        emailErrorCode(error),
      );
      await db.query(
        "UPDATE notifications SET attempts=attempts+1,last_error=$3,delivery_status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [n.id, claim, emailErrorCode(error)],
      );
    }
  }
}
