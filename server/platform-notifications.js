import express from "express";
import nodemailer from "nodemailer";
import { rows, one, insert } from "./db.js";
import { z, text } from "./validation.js";
import { fail, token } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { smtpConfig } from "./integrations.js";
import { subscriptionEvent } from "./saas-service.js";
import { renderEmail } from "./email-templates.js";
import { newsletterUnsubscribeLink } from "./contact-consent.js";

export async function queueNotice(
  db,
  user,
  { title, body, link, key, sender = null, template_key = "notification" },
) {
  await db.query(
    `INSERT INTO platform_notifications(user_id,school_id,email,title,body,link,dedupe_key,sender_id,template_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,dedupe_key) DO NOTHING`,
    [
      user.id,
      user.school_id,
      user.email,
      title,
      body,
      link,
      key,
      sender,
      template_key,
    ],
  );
}
export async function supportNotice(db, ticket, actor, reply = false) {
  const recipients = reply
    ? await rows(
        db,
        "SELECT id,school_id,email FROM users WHERE id=$1 AND status='ACTIVE'",
        [ticket.user_id],
      )
    : await rows(
        db,
        `SELECT DISTINCT u.id,u.school_id,u.email FROM users u
      LEFT JOIN platform_operators p ON p.user_id=u.id LEFT JOIN platform_staff ps ON ps.user_id=u.id
      WHERE u.status='ACTIVE' AND u.email_verified AND (p.user_id IS NOT NULL OR ps.scope=$1)`,
        [ticket.department],
      );
  for (const recipient of recipients)
    await queueNotice(db, recipient, {
      title: reply
        ? `SMPIS replied to support ticket #${ticket.id}`
        : `New ${ticket.department.toLowerCase()} support ticket #${ticket.id}`,
      body: `${ticket.subject}\n\n${reply ? ticket.resolution || "Your support request status has been updated." : ticket.description}`,
      link: reply
        ? "/" +
          (
            await one(db, "SELECT portal_slug FROM schools WHERE id=$1", [
              ticket.school_id,
            ])
          ).portal_slug +
          "/#support"
        : "/owner#issues",
      key: `support:${ticket.id}:${reply ? ticket.updated_at.toISOString() : "created"}`,
      sender: actor.id,
      template_key: reply ? "support_reply" : "support_received",
    });
}

export async function deliverPlatformNotifications(
  db,
  {
    configuration = smtpConfig,
    send = async (smtp, notice) =>
      nodemailer
        .createTransport(
          typeof smtp.transport === "string"
            ? {
                url: smtp.transport,
                connectionTimeout: 15000,
                socketTimeout: 45000,
              }
            : {
                ...smtp.transport,
                connectionTimeout: 15000,
                socketTimeout: 45000,
              },
        )
        .sendMail({
          from: smtp.from,
          to: notice.email,
          ...(await renderEmail(db, notice.template_key, {
            title: notice.title,
            body: notice.body,
            link: process.env.APP_URL
              ? new URL(notice.link, process.env.APP_URL).href
              : notice.link,
            unsubscribe_link:
              notice.template_key === "promotional_newsletter"
                ? newsletterUnsubscribeLink({
                    id: notice.user_id,
                    email: notice.email,
                  })
                : "",
          })),
        }),
  } = {},
) {
  const smtp = await configuration(db, null);
  if (!smtp) return;
  const candidates = await rows(
    db,
    `SELECT n.id FROM platform_notifications n JOIN users u ON u.id=n.user_id
    WHERE n.email_status='PENDING' AND n.attempts<5 AND n.read_at IS NULL AND u.status='ACTIVE' AND u.email_verified
    AND (n.template_key<>'mfa_reminder' OR NOT u.mfa_enabled)
    AND (n.template_key<>'promotional_newsletter' OR u.marketing_email_consent)
    AND (n.template_key<>'mfa_reminder' OR n.school_id IS NULL OR EXISTS(
      SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=n.school_id
      AND sc.status IN ('TRIAL','ACTIVE') AND sc.closed_at IS NULL
      AND sc.deletion_requested_at IS NULL AND sc.period_end>now()))
    AND (n.claimed_until IS NULL OR n.claimed_until<=now())
    AND NOT EXISTS(SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=n.school_id AND (sc.closed_at IS NOT NULL OR sc.deletion_effective_at<=now()))
    AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=n.user_id AND s.expires_at>now() AND s.mfa_verified AND s.last_seen_at>now()-interval '2 minutes')
    ORDER BY n.created_at LIMIT 100`,
  );
  for (const candidate of candidates) {
    const claim = token();
    const notice = await one(
      db,
      `UPDATE platform_notifications n SET claim_token=$2,claimed_until=now()+interval '5 minutes'
      WHERE n.id=$1 AND n.email_status='PENDING' AND n.read_at IS NULL AND n.attempts<5
      AND (n.claimed_until IS NULL OR n.claimed_until<=now())
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=n.user_id AND u.status='ACTIVE' AND u.email_verified AND (n.template_key<>'mfa_reminder' OR NOT u.mfa_enabled) AND (n.template_key<>'promotional_newsletter' OR u.marketing_email_consent))
      AND (n.template_key<>'mfa_reminder' OR n.school_id IS NULL OR EXISTS(
        SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=n.school_id
        AND sc.status IN ('TRIAL','ACTIVE') AND sc.closed_at IS NULL
        AND sc.deletion_requested_at IS NULL AND sc.period_end>now()))
      AND NOT EXISTS(SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=n.school_id AND (sc.closed_at IS NOT NULL OR sc.deletion_effective_at<=now()))
      AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=n.user_id AND s.expires_at>now() AND s.mfa_verified AND s.last_seen_at>now()-interval '2 minutes') RETURNING n.*`,
      [candidate.id, claim],
    );
    if (!notice) continue;
    try {
      await send(smtp, notice);
      await db.query(
        "UPDATE platform_notifications SET email_status='SENT',sent_at=now(),claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [notice.id, claim],
      );
    } catch {
      await db.query(
        "UPDATE platform_notifications SET attempts=attempts+1,email_status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [notice.id, claim],
      );
    }
  }
}

export function platformNotificationRoutes(db) {
  const r = express.Router();
  r.post("/subscription/notices/presence", async (req, res) => {
    await db.query(
      "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND mfa_verified",
      [req.sessionHash],
    );
    res.json({ data: { ok: true } });
  });
  r.get("/subscription/notices", async (req, res) =>
    res.json({
      data: await rows(
        db,
        "SELECT id,title,body,link,read_at,email_status,created_at FROM platform_notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
        [req.user.id],
      ),
    }),
  );
  r.post("/subscription/notices/read-all", async (req, res) => {
    const result = await db.query(
      "UPDATE platform_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL RETURNING id",
      [req.user.id],
    );
    res.json({ data: { count: result.rows.length } });
  });
  r.post("/subscription/notices/:id/read", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const notice = await one(
      db,
      "UPDATE platform_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, req.user.id],
    );
    if (!notice) fail(404, "Notification not found.");
    res.json({ data: notice });
  });
  r.get("/saas/owner/contacts", requireOwner, async (req, res) => {
    const contacts = await rows(
      db,
      `SELECT u.id,u.name,u.email,u.phone_number,u.marketing_email_consent,u.marketing_phone_consent,u.contact_preferences_updated_at,u.school_id,c.name AS school_name,c.portal_slug,s.status,s.suspension_reason
      FROM users u JOIN schools c ON c.id=u.school_id JOIN school_subscriptions s ON s.school_id=c.id
      WHERE u.role='SUPER_ADMIN' AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id)
      AND ($1='' OR ($1='email' AND u.marketing_email_consent) OR ($1='phone' AND u.marketing_phone_consent)) ORDER BY c.name,u.name`,
      [z.enum(["", "email", "phone"]).parse(req.query.marketing || "")],
    );
    if (req.query.format === "csv") {
      const keys = [
        "school_name",
        "name",
        "email",
        "phone_number",
        "marketing_email_consent",
        "marketing_phone_consent",
        "portal_slug",
        "status",
      ];
      const cell = (value) =>
        '"' +
        String(value ?? "")
          .replace(/^[\s]*[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      return res
        .set(
          "Content-Disposition",
          'attachment; filename="smpis-tenant-contacts.csv"',
        )
        .type("text/csv")
        .send(
          "\uFEFF" +
            [
              keys.map(cell).join(","),
              ...contacts.map((c) => keys.map((k) => cell(c[k])).join(",")),
            ].join("\r\n"),
        );
    }
    res.json({ data: contacts });
  });
  r.post("/saas/owner/notifications", requireOwner, async (req, res) => {
    const b = z
      .object({
        title: text.max(200),
        body: z.string().trim().min(1).max(5000),
        audience: z.enum(["SELECTED", "ALL"]),
        message_kind: z.enum(["SERVICE", "PROMOTIONAL"]).default("SERVICE"),
        school_ids: z.array(z.number().int().positive()).max(1000).default([]),
      })
      .strict()
      .parse(req.body);
    if (b.audience === "SELECTED" && !b.school_ids.length)
      fail(422, "Select at least one school.");
    const result = await db.transaction(async (tx) => {
      const recipients = await rows(
        tx,
        `SELECT u.id,u.school_id,u.email FROM users u JOIN school_subscriptions s ON s.school_id=u.school_id
        WHERE u.role='SUPER_ADMIN' AND u.status='ACTIVE' AND u.email_verified AND s.closed_at IS NULL
        AND (s.deletion_effective_at IS NULL OR s.deletion_effective_at>now())
        AND NOT EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id)
        AND ($3='SERVICE' OR u.marketing_email_consent)
        AND ($1::boolean OR u.school_id=ANY($2::int[]))`,
        [b.audience === "ALL", b.school_ids, b.message_kind],
      );
      if (!recipients.length)
        fail(422, "No eligible school administrators match this audience.");
      const batch = token();
      for (const user of recipients)
        await queueNotice(tx, user, {
          ...b,
          link:
            "/" +
            (
              await one(tx, "SELECT portal_slug FROM schools WHERE id=$1", [
                user.school_id,
              ])
            ).portal_slug +
            "/#notifications",
          key: "broadcast:" + batch,
          sender: req.user.id,
          template_key:
            b.message_kind === "PROMOTIONAL"
              ? "promotional_newsletter"
              : "notification",
        });
      await subscriptionEvent(
        tx,
        null,
        req.user.id,
        "TENANT_NOTIFICATION_SENT",
        {
          batch,
          title: b.title,
          recipients: recipients.length,
          audience: b.audience,
          message_kind: b.message_kind,
        },
      );
      return {
        message: `Notification queued for ${recipients.length} school administrator(s).`,
        recipients: recipients.length,
      };
    });
    res.status(201).json({ data: result });
  });
  return r;
}
