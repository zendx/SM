import { supportNotice } from "./platform-notifications.js";
import { consoleAccess, supportDepartment } from "./platform-access.js";
import express from "express";
import { one, rows, insert } from "./db.js";
import { z, text, email, password } from "./validation.js";
import {
  fail,
  token,
  digest,
  ROLE_PERMISSIONS,
  verifyPassword,
  hashPassword,
} from "./security.js";
import { subscriptionEvent } from "./saas-service.js";
import { siteOrigin } from "./seo.js";

export async function ownerMetrics(db) {
  return one(
    db,
    `WITH customers AS (
    SELECT s.* FROM schools s WHERE NOT EXISTS(SELECT 1 FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE u.school_id=s.id)
  ) SELECT
    (SELECT count(*)::int FROM customers) AS registered_schools,
    (SELECT count(*)::int FROM users u JOIN customers c ON c.id=u.school_id) AS user_accounts,
    (SELECT count(*)::int FROM customers c WHERE EXISTS(SELECT 1 FROM subscription_payments p WHERE p.school_id=c.id AND p.status IN ('PAID','REVIEW'))) AS paid_schools,
    (SELECT count(*)::int FROM customers c JOIN school_subscriptions s ON s.school_id=c.id WHERE s.status='TRIAL') AS trial_schools,
    (SELECT count(*)::int FROM customers c JOIN school_subscriptions s ON s.school_id=c.id WHERE s.status='ACTIVE' AND s.plan='PRO') AS active_pro_schools,
    (SELECT count(*)::int FROM customers c WHERE c.created_at>=date_trunc('month',now())) AS signups_this_month,
    (SELECT count(*)::int FROM saas_support_tickets t WHERE t.status<>'RESOLVED') AS open_issues`,
  );
}
export async function ownerActivity(db) {
  return rows(
    db,
    `SELECT to_char(m.month,'YYYY-MM') AS month,
    (SELECT count(*)::int FROM schools s WHERE s.created_at>=m.month AND s.created_at<m.month+interval '1 month'
      AND NOT EXISTS(SELECT 1 FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE u.school_id=s.id)) AS signups,
    (SELECT COALESCE(sum(p.amount_cents),0)::bigint FROM subscription_payments p WHERE p.status IN ('PAID','REVIEW')
      AND p.paid_at>=m.month AND p.paid_at<m.month+interval '1 month') AS revenue_cents
    FROM generate_series(date_trunc('month',now())-interval '5 months',date_trunc('month',now()),interval '1 month') AS m(month)
    ORDER BY m.month`,
  );
}
export function ownerSupportRoutes(db) {
  const r = express.Router();
  r.get("/subscription/support", async (req, res) => {
    if (req.user.role !== "SUPER_ADMIN")
      fail(403, "School administrator access required.");
    res.json({
      data: await rows(
        db,
        `SELECT t.*,COALESCE((SELECT json_agg(json_build_object('id',r.id,'body',r.body,'author',u.name,'created_at',r.created_at) ORDER BY r.id) FROM saas_support_replies r JOIN users u ON u.id=r.user_id WHERE r.ticket_id=t.id),'[]'::json) AS replies FROM saas_support_tickets t WHERE school_id=$1 ORDER BY updated_at DESC LIMIT 100`,
        [req.user.school_id],
      ),
    });
  });
  r.post("/subscription/support", async (req, res) => {
    if (req.user.role !== "SUPER_ADMIN")
      fail(403, "School administrator access required.");
    const b = z
      .object({
        department: z.enum(["SALES", "TECHNICAL"]).default("TECHNICAL"),
        subject: text.max(200),
        description: z.string().trim().min(10).max(5000),
      })
      .strict()
      .parse(req.body);
    const ticket = await db.transaction(async (tx) => {
      const t = await insert(tx, "saas_support_tickets", {
        school_id: req.user.school_id,
        user_id: req.user.id,
        ...b,
      });
      await subscriptionEvent(
        tx,
        req.user.school_id,
        req.user.id,
        "SUPPORT_REQUESTED",
        { ticket_id: t.id, subject: t.subject, department: t.department },
      );
      await supportNotice(tx, t, req.user);
      return t;
    });
    res.status(201).json({ data: ticket });
  });
  r.use("/saas/owner", (req, res, next) => {
    if (!consoleAccess(req.user)) fail(403, "SMPIS console access required.");
    if (!req.user.platform_operator) {
      const support =
        /^\/issues(?:\/\d+)?$/.test(req.path) &&
        ["SALES", "TECHNICAL"].includes(req.user.platform_scope);
      const subscription =
        /^\/tenants\/\d+$/.test(req.path) &&
        req.method === "PATCH" &&
        req.user.platform_scope === "SUBSCRIPTIONS";
      const profile = req.path === "/profile" && req.method === "PATCH";
      if (!support && !subscription && !profile)
        fail(
          403,
          "Your delegated account does not have permission for this console action.",
        );
    }
    next();
  });
  r.patch("/saas/owner/profile", async (req, res) => {
    const b = z
      .object({
        name: text.max(200),
        email,
        current_password: z.string().min(1).max(128),
        new_password: password.optional(),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const user = await one(
        tx,
        "SELECT id,name,email,password_hash FROM users WHERE id=$1 FOR UPDATE",
        [req.user.id],
      );
      if (!verifyPassword(b.current_password, user.password_hash))
        fail(422, "Your current password is incorrect.");
      await tx.query(
        "UPDATE users SET name=$2,email=$3,password_hash=$4 WHERE id=$1",
        [
          user.id,
          b.name,
          b.email,
          b.new_password ? hashPassword(b.new_password) : user.password_hash,
        ],
      );
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [user.id, req.sessionHash],
      );
      await tx.query("DELETE FROM reset_tokens WHERE user_id=$1", [user.id]);
      await subscriptionEvent(
        tx,
        req.user.school_id,
        user.id,
        "OWNER_PROFILE_UPDATED",
        {
          before: { name: user.name, email: user.email },
          after: { name: b.name, email: b.email },
          password_changed: !!b.new_password,
        },
      );
    });
    res.json({
      data: {
        message:
          "Owner credentials updated. Other signed-in sessions have been ended.",
      },
    });
  });
  r.get("/saas/owner/users", async (req, res) => {
    const search = z
        .string()
        .trim()
        .max(200)
        .parse(req.query.search || ""),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(req.query.page || 1);
    const where = `u.school_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id)
      AND (u.name ILIKE $1 OR u.email ILIKE $1 OR s.name ILIKE $1)`;
    const args = ["%" + search + "%"];
    const users = await rows(
      db,
      `SELECT u.id,u.school_id,u.name,u.email,u.role,u.status,u.mfa_enabled,u.created_at,s.name AS school_name,s.portal_slug,
      (SELECT count(*)::int FROM sessions se WHERE se.user_id=u.id AND se.expires_at>now()) AS active_sessions
      FROM users u JOIN schools s ON s.id=u.school_id WHERE ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT 50 OFFSET $2`,
      [...args, (page - 1) * 50],
    );
    const { total } = await one(
      db,
      `SELECT count(*)::int AS total FROM users u JOIN schools s ON s.id=u.school_id WHERE ${where}`,
      args,
    );
    res.json({
      data: { users, total, page, roles: Object.keys(ROLE_PERMISSIONS) },
    });
  });
  r.post("/saas/owner/users/:id/action", async (req, res) => {
    const uid = z.coerce.number().int().positive().parse(req.params.id);
    const b = z
      .object({
        action: z.enum([
          "UPDATE",
          "REVOKE_SESSIONS",
          "RESET_PASSWORD",
          "RESET_MFA",
        ]),
        reason: text.max(1000),
        name: text.max(200).optional(),
        email: email.optional(),
        role: z.enum(Object.keys(ROLE_PERMISSIONS)).optional(),
        status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
      })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const record = await one(
        tx,
        "SELECT id,school_id FROM users WHERE id=$1",
        [uid],
      );
      if (!record || !record.school_id) fail(404, "School user not found.");
      await tx.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
        record.school_id,
      ]);
      const u = await one(
        tx,
        "SELECT id,school_id,name,email,role,status,mfa_enabled FROM users WHERE id=$1 FOR UPDATE",
        [uid],
      );
      if (
        await one(
          tx,
          "SELECT user_id FROM platform_operators WHERE user_id=$1",
          [uid],
        )
      )
        fail(403, "Owner accounts cannot be changed through customer support.");
      let response = { message: "Account updated." },
        details = { reason: b.reason, user_id: uid, action: b.action };
      if (b.action === "UPDATE") {
        const lifecycle = await one(
          tx,
          "SELECT deletion_requested_at FROM school_subscriptions WHERE school_id=$1",
          [u.school_id],
        );
        if (lifecycle?.deletion_requested_at && b.email && b.email !== u.email)
          fail(
            422,
            "Reactivate this school before changing its reserved email addresses.",
          );
        const updated = {
          name: b.name ?? u.name,
          email: b.email ?? u.email,
          role: b.role ?? u.role,
          status: b.status ?? u.status,
        };
        if (
          u.role === "SUPER_ADMIN" &&
          u.status === "ACTIVE" &&
          (updated.role !== "SUPER_ADMIN" || updated.status !== "ACTIVE")
        ) {
          const { n } = await one(
            tx,
            "SELECT count(*)::int AS n FROM users WHERE school_id=$1 AND role='SUPER_ADMIN' AND status='ACTIVE'",
            [u.school_id],
          );
          if (n <= 1)
            fail(
              422,
              "Keep at least one active school administrator. Suspend the school subscription to pause the entire portal.",
            );
        }
        await tx.query(
          "UPDATE users SET name=$2,email=$3,role=$4,status=$5 WHERE id=$1",
          [uid, updated.name, updated.email, updated.role, updated.status],
        );
        details = { ...details, before: u, after: updated };
      }
      if (b.action === "RESET_PASSWORD") {
        const raw = token();
        await tx.query("DELETE FROM reset_tokens WHERE user_id=$1", [uid]);
        await insert(tx, "reset_tokens", {
          user_id: uid,
          token_hash: digest(raw),
          expires_at: new Date(Date.now() + 1800000),
        });
        response = {
          message:
            "One-time password reset link created. Share it securely after verifying the account holder.",
          reset_url: `${siteOrigin()}/?reset=${raw}`,
          expires_in_minutes: 30,
        };
      }
      if (b.action === "RESET_MFA") {
        await tx.query(
          "UPDATE users SET mfa_enabled=false,mfa_secret=NULL WHERE id=$1",
          [uid],
        );
        await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [
          uid,
        ]);
      }
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await subscriptionEvent(
        tx,
        u.school_id,
        req.user.id,
        "USER_SUPPORT_ACTION",
        details,
      );
      return response;
    });
    res.json({ data: result });
  });
  r.get("/saas/owner/issues", async (req, res) => {
    const department = supportDepartment(req.user);
    res.json({
      data: await rows(
        db,
        `SELECT t.*,s.name AS school_name,u.name AS user_name,u.email AS user_email,
        COALESCE((SELECT json_agg(json_build_object('id',r.id,'body',r.body,'author',a.name,'created_at',r.created_at) ORDER BY r.id) FROM saas_support_replies r JOIN users a ON a.id=r.user_id WHERE r.ticket_id=t.id),'[]'::json) AS replies
       FROM saas_support_tickets t JOIN schools s ON s.id=t.school_id JOIN users u ON u.id=t.user_id
       WHERE ($1::text IS NULL OR t.department=$1)
       ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 250`,
        [department],
      ),
    });
  });
  r.patch("/saas/owner/issues/:id", async (req, res) => {
    const department = supportDepartment(req.user);
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = z
      .object({
        status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
        resolution: z.string().trim().max(5000).default(""),
      })
      .strict()
      .parse(req.body);
    const ticket = await db.transaction(async (tx) => {
      const before = await one(
        tx,
        "SELECT * FROM saas_support_tickets WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!before || (department && before.department !== department))
        fail(404, "Support issue not found.");
      if (b.status === "RESOLVED" && !b.resolution && !before.resolution)
        fail(422, "Reply to the customer before resolving the issue.");
      const t = await one(
        tx,
        "UPDATE saas_support_tickets SET status=$2,resolution=$3,updated_by=$4,updated_at=now() WHERE id=$1 RETURNING *",
        [id, b.status, b.resolution || before.resolution, req.user.id],
      );
      if (b.resolution && b.resolution !== before.resolution)
        await insert(tx, "saas_support_replies", {
          ticket_id: id,
          user_id: req.user.id,
          body: b.resolution,
        });
      await subscriptionEvent(tx, t.school_id, req.user.id, "SUPPORT_UPDATED", {
        ticket_id: id,
        previous_status: before.status,
        status: t.status,
      });
      if (b.resolution && b.resolution !== before.resolution)
        await supportNotice(tx, t, req.user, true);
      return t;
    });
    res.json({ data: ticket });
  });
  return r;
}
