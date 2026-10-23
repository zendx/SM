import "dotenv/config";
import pg from "pg";
import nodemailer from "nodemailer";
import {
  emailConfiguration,
  emailConfigurationStatus,
} from "../server/email-configuration.js";
import { postgresConfiguration } from "../server/postgres-config.js";

// Read-only: never runs jobs, changes queued messages or sends email.
const pool = new pg.Pool({
  ...postgresConfiguration(process.env.DATABASE_URL),
  connectionTimeoutMillis: 10000,
});
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='15s'");
    for (const [name, sql] of Object.entries({
      platform:
        "SELECT email_status, count(*)::int AS messages, min(created_at) AS oldest, max(sent_at) AS last_sent, max(attempts) AS max_attempts, count(*) FILTER(WHERE read_at IS NOT NULL)::int AS read_messages,count(*) FILTER(WHERE claimed_until>now())::int AS active_claims FROM platform_notifications GROUP BY email_status",
      school:
        "SELECT delivery_status, count(*)::int AS messages, min(created_at) AS oldest, max(sent_at) AS last_sent, max(attempts) AS max_attempts,count(*) FILTER(WHERE claimed_until>now())::int AS active_claims FROM notifications GROUP BY delivery_status",
      onboarding:
        "SELECT delivery_status,count(*)::int AS messages,max(attempts) AS max_attempts FROM onboarding_email_queue GROUP BY delivery_status",
      verification:
        "SELECT count(*)::int AS queued, max(attempts) AS max_attempts FROM verification_outbox",
      platform_eligibility: `SELECT count(*)::int AS pending,
        count(*) FILTER(WHERE n.read_at IS NOT NULL)::int AS already_read,
        count(*) FILTER(WHERE NOT u.email_verified OR u.status<>'ACTIVE')::int AS inactive_or_unverified,
        count(*) FILTER(WHERE n.attempts>=5)::int AS exhausted,
        count(*) FILTER(WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=n.user_id AND s.expires_at>now() AND s.mfa_verified AND s.last_seen_at>now()-interval '2 minutes'))::int AS recently_online
        FROM platform_notifications n JOIN users u ON u.id=n.user_id WHERE n.email_status='PENDING'`,
    }))
      console.log(name, JSON.stringify((await client.query(sql)).rows));
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
} catch (e) {
  console.log(
    "database_check_failed",
    JSON.stringify({ code: e.code || e.name }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
if (emailConfigurationStatus().configured) {
  let transport;
  try {
    const configuration = emailConfiguration();
    let options = configuration.transport;
    if (typeof options === "string") {
      const url = new URL(options);
      for (const key of [
        "connectionTimeout",
        "greetingTimeout",
        "socketTimeout",
      ])
        url.searchParams.set(key, "10000");
      options = url.href;
    }
    transport = nodemailer.createTransport(options);
    await transport.verify();
    console.log(
      "email_verification",
      `${emailConfigurationStatus().provider}: passed (no email sent)`,
    );
  } catch (e) {
    console.log(
      "email_verification_failed",
      JSON.stringify({
        code: e.code,
        responseCode: e.responseCode,
        command: e.command,
      }),
    );
    process.exitCode = 1;
  } finally {
    transport?.close();
  }
} else
  console.log(
    "email_verification",
    "Selected email provider is missing required private environment variables.",
  );
