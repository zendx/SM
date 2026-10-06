import { smtpConfig } from "./integrations.js";
import nodemailer from "nodemailer";
import { rows, one } from "./db.js";
import { refreshAlerts } from "./services.js";
import { localClock, token } from "./security.js";
import { refreshOperationAlerts } from "./operations-service.js";
import { expireSubscriptions } from "./saas-service.js";
export async function runJobs(db) {
  await expireSubscriptions(db);
  // Database dedupe keys make reminders safe across overlapping job runners.
  await db.query(`INSERT INTO notifications(school_id,user_id,email,title,body,dedupe_key)
    SELECT s.school_id,u.id,u.email,
      CASE WHEN s.status='SUSPENDED' THEN 'SMPIS subscription access paused' ELSE 'Your SMPIS subscription expires soon' END,
      CASE WHEN s.status='SUSPENDED' THEN 'Your school subscription has expired. Sign in to your portal and open Subscription to renew. Your school records are retained.'
        ELSE 'Your SMPIS access expires on ' || to_char(s.period_end AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') || ' UTC. Open Subscription in your school portal to renew. Pro is USD 100 monthly or USD 1020 yearly.' END,
      'saas-reminder:' || s.period_end::text || ':' || u.id::text || ':' || CASE WHEN s.status='SUSPENDED' THEN 'expired' ELSE ceil(extract(epoch FROM (s.period_end-now()))/86400)::text END
    FROM school_subscriptions s JOIN users u ON u.school_id=s.school_id AND u.role='SUPER_ADMIN' AND u.status='ACTIVE'
    WHERE NOT EXISTS(SELECT 1 FROM platform_operators o JOIN users a ON a.id=o.user_id WHERE a.school_id=s.school_id)
      AND ((s.status IN ('TRIAL','ACTIVE') AND ceil(extract(epoch FROM (s.period_end-now()))/86400) IN (1,3,7))
      OR (s.status='SUSPENDED' AND s.suspension_reason IN ('TRIAL_EXPIRED','OVERDUE')))
    ON CONFLICT(school_id,dedupe_key) DO NOTHING`);
  await db.query("DELETE FROM auth_rate_limits WHERE reset_at<now()");
  for (const school of await rows(db, "SELECT * FROM schools")) {
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
  await deliverNotifications(db);
}

export async function deliverNotifications(
  db,
  {
    configuration = smtpConfig,
    send = async (smtp, n) =>
      nodemailer
        .createTransport({
          ...(typeof smtp.transport === "string"
            ? { url: smtp.transport }
            : smtp.transport),
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 45000,
        })
        .sendMail({
          from: smtp.from,
          to: n.email,
          subject: n.title,
          text: n.body,
        }),
  } = {},
) {
  for (const candidate of await rows(
    db,
    "SELECT * FROM notifications WHERE delivery_status='PENDING' AND attempts<5 AND email<>'' AND (claimed_until IS NULL OR claimed_until<=now()) ORDER BY created_at LIMIT 50",
  )) {
    const smtp = await configuration(db, candidate.school_id);
    if (!smtp) continue;
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
        "UPDATE notifications SET delivery_status='SENT',sent_at=now(),claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [n.id, claim],
      );
    } catch {
      await db.query(
        "UPDATE notifications SET attempts=attempts+1,delivery_status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [n.id, claim],
      );
    }
  }
}
