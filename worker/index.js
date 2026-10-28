import "dotenv/config";
import { EMAIL_TEMPLATE_REVISION, emailOrigin } from "../server/email-urls.js";
import { openDatabase } from "../server/db.js";
import { runJobs } from "../server/jobs.js";
import { emailConfigurationStatus } from "../server/email-configuration.js";

const intervalMs = 60_000;
const db = await openDatabase({ initialize: false });
try {
  await db.query(
    "SELECT n.last_error,p.last_error,o.last_error,w.smtp_configured,w.email_provider FROM notifications n,platform_notifications p,onboarding_email_queue o,background_worker_status w LIMIT 0",
  );
  await db.query("SELECT sent_count,next_send_at FROM tenant_setup_reminders LIMIT 0");
} catch {
  await db.close();
  throw new Error(
    "Worker email schema is outdated. Run npm run supabase:setup before deploying this worker.",
  );
}
let stopping = false;
let timer;
let wakeDelay;

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  wakeDelay?.();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);

console.log("SMPIS background worker started.");
console.log(`Worker email templates: ${EMAIL_TEMPLATE_REVISION}.`);
// Log only the public origin, never query strings, credentials or API keys.
try {
  const publicUrl = new URL(emailOrigin());
  console.log(
    `Worker public email origin: ${publicUrl.protocol}//${publicUrl.host}.`,
  );
} catch {
  console.error("Worker public email origin is invalid. Check APP_URL.");
}
const emailStatus = emailConfigurationStatus();
console.log(
  `Worker email provider: ${emailStatus.provider}; ${emailStatus.configured ? "configured" : "missing required email variables; messages will remain queued"}.`,
);
let heartbeatBusy = false;
const heartbeat = setInterval(async () => {
  if (heartbeatBusy || stopping) return;
  heartbeatBusy = true;
  try {
    await db.query(
      "UPDATE background_worker_status SET last_seen_at=now() WHERE id=1",
    );
  } catch {
    console.error(
      "Worker heartbeat unavailable. Apply the latest database schema.",
    );
  } finally {
    heartbeatBusy = false;
  }
}, 30000);
heartbeat.unref();

try {
  while (!stopping) {
    try {
      await runJobs(db);
      console.log("Background job run completed.");
    } catch (error) {
      console.error("Background job run failed:", error);
    }
    if (!stopping)
      await new Promise((resolve) => {
        wakeDelay = resolve;
        timer = setTimeout(() => {
          wakeDelay = undefined;
          resolve();
        }, intervalMs);
      });
  }
} finally {
  clearInterval(heartbeat);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.removeListener(signal, stop);
  await db.close();
  console.log("SMPIS background worker stopped.");
}
