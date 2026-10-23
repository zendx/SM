import express from "express";
import { emailConfigurationStatus } from "./email-configuration.js";
import { one, rows, audit } from "./db.js";
import { requireOwner } from "./platform-access.js";

export function emailDeliveryRoutes(db) {
  const r = express.Router(),
    base = "/saas/owner/email-delivery";
  r.use(base, requireOwner);
  r.get(base, async (req, res) => {
    const worker = await one(
      db,
      "SELECT *,last_seen_at>now()-interval '3 minutes' AS recent FROM background_worker_status WHERE id=1",
    );
    const counts = await rows(
      db,
      `SELECT 'Platform notifications' AS queue,email_status AS status,count(*)::int AS count,min(created_at) AS oldest FROM platform_notifications GROUP BY email_status
      UNION ALL SELECT 'School notifications',delivery_status,count(*)::int,min(created_at) FROM notifications GROUP BY delivery_status
      UNION ALL SELECT 'Onboarding emails',delivery_status,count(*)::int,min(created_at) FROM onboarding_email_queue GROUP BY delivery_status`,
    );
    const failures = await rows(
      db,
      `SELECT 'Platform notifications' AS queue,id,email,attempts,last_error,created_at FROM platform_notifications WHERE email_status='FAILED' OR last_error<>''
      UNION ALL SELECT 'School notifications',id,email,attempts,last_error,created_at FROM notifications WHERE delivery_status='FAILED' OR last_error<>''
      UNION ALL SELECT 'Onboarding emails',q.id,u.email,q.attempts,q.last_error,q.created_at FROM onboarding_email_queue q JOIN users u ON u.id=q.user_id WHERE q.delivery_status='FAILED' OR q.last_error<>''
      ORDER BY created_at DESC LIMIT 25`,
    );
    res.json({
      data: {
        worker: worker || null,
        web_smtp_configured: emailConfigurationStatus().configured,
        web_email_provider: emailConfigurationStatus().provider,
        counts,
        failures,
      },
    });
  });
  r.post(base + "/retry", async (req, res) => {
    const result = await db.transaction(async (tx) => {
      let count = 0;
      for (const [table, column] of [
        ["platform_notifications", "email_status"],
        ["notifications", "delivery_status"],
        ["onboarding_email_queue", "delivery_status"],
      ]) {
        const retried = await tx.query(
          `UPDATE ${table} SET ${column}='PENDING',attempts=0,last_error='',claim_token=NULL,claimed_until=NULL${table === "onboarding_email_queue" ? ",next_attempt_at=now()" : ""} WHERE ${column}='FAILED' AND (claimed_until IS NULL OR claimed_until<=now()) RETURNING id`,
        );
        count += retried.rows.length;
      }
      await audit(
        tx,
        req.user,
        "saas_settings",
        1,
        "FAILED_EMAILS_REQUEUED",
        null,
        { count },
      );
      return {
        count,
        message: `${count} failed email(s) queued for the next worker run.`,
      };
    });
    res.json({ data: result });
  });
  return r;
}
