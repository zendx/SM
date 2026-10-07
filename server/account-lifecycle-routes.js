import express from "express";
import { one } from "./db.js";
import { z, text } from "./validation.js";
import { fail, verifyPassword } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { subscriptionEvent } from "./saas-service.js";

export function accountLifecycleRoutes(db) {
  const r = express.Router();
  r.post("/subscription/account", async (req, res) => {
    if (req.user.role !== "SUPER_ADMIN" || req.user.platform_operator)
      fail(403, "A school administrator must request this account change.");
    const b = z
      .object({
        action: z.enum(["PAUSE", "RESUME", "DELETE"]),
        password: z.string().min(1).max(128),
        reason: text.max(1000),
      })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT password_hash FROM users WHERE id=$1",
        [req.user.id],
      );
      if (!verifyPassword(b.password, user.password_hash))
        fail(422, "Your password is incorrect.");
      if (
        await one(
          tx,
          "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE u.school_id=$1",
          [req.user.school_id],
        )
      )
        fail(403, "The owner workspace cannot be paused or closed.");
      const sub = await one(
        tx,
        "SELECT * FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
        [req.user.school_id],
      );
      if (!sub) fail(404, "Subscription not found.");
      if (sub.deletion_requested_at || sub.closed_at)
        fail(
          409,
          "Deletion has already been requested. Contact SMPIS for reactivation.",
        );
      if (b.action === "PAUSE") {
        if (!["TRIAL", "ACTIVE", "PENDING_PAYMENT"].includes(sub.status))
          fail(409, "Only an active or pending subscription can be paused.");
        await tx.query(
          "UPDATE school_subscriptions SET tenant_previous_status=status,status='SUSPENDED',suspension_reason='TENANT_PAUSED',updated_at=now() WHERE school_id=$1",
          [req.user.school_id],
        );
      } else if (b.action === "RESUME") {
        if (sub.suspension_reason !== "TENANT_PAUSED")
          fail(
            409,
            "Only a subscription paused by your school can be resumed.",
          );
        const previous =
          sub.tenant_previous_status ||
          (sub.plan === "FREE" ? "TRIAL" : "ACTIVE");
        await tx.query(
          "UPDATE school_subscriptions SET status=$2,suspension_reason='',tenant_previous_status=NULL,updated_at=now() WHERE school_id=$1",
          [req.user.school_id, previous],
        );
      } else {
        if (sub.status === "TERMINATED")
          fail(409, "Contact SMPIS to manage this terminated account.");
        await tx.query(
          `UPDATE school_subscriptions SET tenant_previous_status=status,status='SUSPENDED',
          suspension_reason='DELETION_REQUESTED',deletion_requested_at=now(),deletion_effective_at=now()+interval '3 months',updated_at=now()
          WHERE school_id=$1`,
          [req.user.school_id],
        );
      }
      await subscriptionEvent(
        tx,
        req.user.school_id,
        req.user.id,
        "TENANT_" + b.action,
        { reason: b.reason, records_retained: true },
      );
      return one(tx, "SELECT * FROM school_subscriptions WHERE school_id=$1", [
        req.user.school_id,
      ]);
    });
    res.json({ data: result });
  });
  r.post(
    "/saas/owner/tenants/:id/reactivate",
    requireOwner,
    async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const b = z
        .object({ reason: text.max(1000) })
        .strict()
        .parse(req.body);
      await db.transaction(async (tx) => {
        const sub = await one(
          tx,
          "SELECT * FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
          [id],
        );
        if (!sub || !sub.deletion_requested_at)
          fail(422, "This account has no deletion request to reactivate.");
        const active = new Date(sub.period_end) > new Date();
        const status = active
          ? sub.plan === "FREE"
            ? "TRIAL"
            : sub.tenant_previous_status === "PENDING_PAYMENT"
              ? "PENDING_PAYMENT"
              : "ACTIVE"
          : "SUSPENDED";
        await tx.query(
          `UPDATE school_subscriptions SET status=$2,suspension_reason=$3,
        deletion_requested_at=NULL,deletion_effective_at=NULL,closed_at=NULL,tenant_previous_status=NULL,updated_at=now() WHERE school_id=$1`,
          [
            id,
            status,
            active ? "" : sub.plan === "FREE" ? "TRIAL_EXPIRED" : "OVERDUE",
          ],
        );
        await subscriptionEvent(tx, id, req.user.id, "ACCOUNT_REACTIVATED", {
          reason: b.reason,
          trial_restarted: false,
        });
      });
      res.json({
        data: {
          message:
            "School sign-in restored. The original subscription expiry is unchanged.",
        },
      });
    },
  );
  return r;
}
