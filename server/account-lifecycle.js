import { one, rows } from "./db.js";
import { fail } from "./security.js";
import { subscriptionEvent } from "./saas-service.js";

export async function finalizeClosures(db) {
  return db.transaction(async (tx) => {
    const closed = await rows(
      tx,
      `UPDATE school_subscriptions SET closed_at=now(),status='SUSPENDED',
      suspension_reason='ACCOUNT_CLOSED',updated_at=now()
      WHERE deletion_effective_at<=now() AND closed_at IS NULL RETURNING school_id`,
    );
    for (const school of closed) {
      await tx.query(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE school_id=$1 AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=users.id))",
        [school.school_id],
      );
      await subscriptionEvent(tx, school.school_id, null, "ACCOUNT_CLOSED", {
        records_retained: true,
      });
    }
    return closed;
  });
}

export async function checkAccountAccess(db, user) {
  if (!user.school_id || user.platform_operator) return;
  const sub = await one(
    db,
    "SELECT closed_at,deletion_effective_at FROM school_subscriptions WHERE school_id=$1",
    [user.school_id],
  );
  if (
    sub &&
    (sub.closed_at ||
      (sub.deletion_effective_at &&
        new Date(sub.deletion_effective_at) <= new Date()))
  )
    fail(
      403,
      "This school account is closed. Contact SMPIS to reactivate it. Your records and email addresses are retained.",
      "ACCOUNT_CLOSED",
    );
}
