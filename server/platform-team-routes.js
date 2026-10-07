import express from "express";
import { one, rows, insert } from "./db.js";
import { z, text, email, password } from "./validation.js";
import { fail, hashPassword } from "./security.js";
import {
  requireOwner,
  requireSubscriptions,
  staffScopes,
} from "./platform-access.js";
import { sendVerification, verificationMailer } from "./email-verification.js";
import { subscriptionEvent } from "./saas-service.js";

export function platformTeamRoutes(db) {
  const r = express.Router();
  r.get("/saas/owner/team", requireOwner, async (req, res) => {
    res.json({
      data: await rows(
        db,
        `SELECT u.id,u.name,u.email,u.status,u.email_verified,p.scope,p.created_at
      FROM platform_staff p JOIN users u ON u.id=p.user_id ORDER BY u.name`,
      ),
    });
  });
  r.post("/saas/owner/team", requireOwner, async (req, res) => {
    const b = z
      .object({
        name: text.max(200),
        email,
        password,
        scope: z.enum(staffScopes),
      })
      .strict()
      .parse(req.body);
    const mailer = await verificationMailer(db);
    const created = await db.transaction(async (tx) => {
      const user = await insert(tx, "users", {
        school_id: null,
        name: b.name,
        email: b.email,
        password_hash: hashPassword(b.password),
        role: "PLATFORM_STAFF",
        email_verified: false,
      });
      await insert(tx, "platform_staff", {
        user_id: user.id,
        scope: b.scope,
        created_by: req.user.id,
      });
      await sendVerification(tx, user, mailer);
      await subscriptionEvent(tx, null, req.user.id, "TEAM_ACCOUNT_CREATED", {
        user_id: user.id,
        scope: b.scope,
      });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        scope: b.scope,
      };
    });
    res.status(201).json({ data: created });
  });
  r.patch("/saas/owner/team/:id", requireOwner, async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = z
      .object({
        scope: z.enum(staffScopes),
        status: z.enum(["ACTIVE", "SUSPENDED"]),
        reason: text.max(1000),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT * FROM platform_staff WHERE user_id=$1 FOR UPDATE",
        [id],
      );
      if (!user) fail(404, "Delegated team account not found.");
      if (
        await one(
          tx,
          "SELECT user_id FROM platform_operators WHERE user_id=$1",
          [id],
        )
      )
        fail(403, "Full owners cannot be managed as delegated staff.");
      await tx.query("UPDATE platform_staff SET scope=$2 WHERE user_id=$1", [
        id,
        b.scope,
      ]);
      await tx.query("UPDATE users SET status=$2 WHERE id=$1", [id, b.status]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await subscriptionEvent(tx, null, req.user.id, "TEAM_ACCESS_UPDATED", {
        user_id: id,
        ...b,
      });
    });
    res.json({
      data: {
        message: "Team permissions updated. Existing sessions have been ended.",
      },
    });
  });
  r.get("/saas/owner/tenants", requireSubscriptions, async (req, res) => {
    res.json({
      data: await rows(
        db,
        `SELECT s.school_id,c.name,c.portal_slug,s.plan,s.billing_cycle,s.status,
      s.period_end,s.suspension_reason,s.deletion_requested_at,s.deletion_effective_at,s.closed_at
      FROM school_subscriptions s JOIN schools c ON c.id=s.school_id
      WHERE NOT EXISTS(SELECT 1 FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE u.school_id=c.id)
      ORDER BY c.created_at DESC`,
      ),
    });
  });
  return r;
}
