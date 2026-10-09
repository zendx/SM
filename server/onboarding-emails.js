import express from "express";
import nodemailer from "nodemailer";
import { rows, one, insert, audit } from "./db.js";
import { z, text } from "./validation.js";
import { fail, token } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { smtpConfig } from "./integrations.js";
import { emailTemplates, renderEmail } from "./email-templates.js";

export const portalGuide = [
  "Overview — See the school’s key figures and the day’s activity.",
  "Teacher workspace — Teachers see their assigned classes and day-to-day teaching tasks.",
  "Students — Manage learner profiles, guardians and class assignments.",
  "Admissions — Review applications and move accepted learners into enrolment.",
  "Attendance — Record and review student and staff attendance.",
  "Finance — Manage invoices, concessions, payments and outstanding school fees.",
  "Academics — Set up subjects, assessments, grading and academic results.",
  "Curriculum — Plan and track curriculum coverage and teaching progress.",
  "Staff & attendance — Keep staff records and monitor staff attendance.",
  "Reports — View and export the reports available to your role.",
  "Administration — Configure school details, classes, academic calendars, accounts, permissions, integrations and security.",
  "School experience — Follow discipline, complaints and parent feedback.",
  "People & HR — Manage recruitment, leave and staff performance.",
  "Facilities & assets — Track assets, maintenance and school facilities.",
  "Intelligence — Explore the analysis and insights available for your school.",
  "Subscription — Review your trial or plan, renewal and subscription payments. This is separate from student fee collection.",
  "Support — School administrators can contact our Sales or Technical team.",
  "Alerts — Review issues that need attention and follow up with your team.",
  "Notifications — Open the bell for your SMPIS inbox, updates and communication preferences.",
].join("\n\n");
const variables = ["name", "school_name", "link", "security_link", "guide"];
const definition = z
  .object({
    name: text.max(120),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().trim().min(1).max(10000),
    delay_minutes: z.coerce.number().int().min(0).max(43200),
    enabled: z.boolean(),
  })
  .strict();

function validateDefinition(body) {
  const result = definition.parse(body);
  for (const field of [result.subject, result.body]) {
    const remaining = field.replace(/{{\s*(\w+)\s*}}/g, (_, variable) => {
      if (!variables.includes(variable))
        fail(422, `Unknown placeholder: ${variable}.`);
      return "";
    });
    if (remaining.includes("{{") || remaining.includes("}}"))
      fail(422, "Malformed template placeholder.");
  }
  if (!/{{\s*link\s*}}/.test(result.body))
    fail(422, "Include {{link}} so the recipient can open their portal.");
  return result;
}

export async function queueOnboardingEmails(db, user) {
  await db.query(
    `INSERT INTO onboarding_email_queue(user_id,step_id,scheduled_at)
    SELECT $1,s.id,$2::timestamptz+s.delay_minutes*interval '1 minute'
    FROM onboarding_email_steps s WHERE s.enabled
    ON CONFLICT(user_id,step_id) DO NOTHING`,
    [user.id, user.created_at],
  );
}

function valuesFor(user) {
  if (!process.env.APP_URL)
    fail(503, "Onboarding email links are not configured.");
  return {
    name: user.name,
    school_name: user.school_name,
    link: new URL(`/${user.portal_slug}/`, process.env.APP_URL).href,
    security_link: new URL(
      `/${user.portal_slug}/?security=mfa#administration`,
      process.env.APP_URL,
    ).href,
    guide: portalGuide,
  };
}

export async function deliverOnboardingEmails(
  db,
  {
    configuration = smtpConfig,
    send = async (smtp, message, user) =>
      nodemailer
        .createTransport({
          ...(typeof smtp.transport === "string"
            ? { url: smtp.transport }
            : smtp.transport),
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 45000,
        })
        .sendMail({ from: smtp.from, to: user.email, ...message }),
  } = {},
) {
  await db.query(`UPDATE onboarding_email_queue q SET delivery_status='CANCELLED',claim_token=NULL,claimed_until=NULL
    FROM users u JOIN school_subscriptions sc ON sc.school_id=u.school_id
    WHERE q.user_id=u.id AND q.delivery_status='PENDING' AND (q.claimed_until IS NULL OR q.claimed_until<=now())
    AND (u.status<>'ACTIVE' OR sc.deletion_requested_at IS NOT NULL OR sc.closed_at IS NOT NULL OR sc.status='TERMINATED')`);
  const smtp = await configuration(db, null);
  if (!smtp) return;
  const candidates = await rows(
    db,
    `SELECT q.id FROM onboarding_email_queue q
    JOIN onboarding_email_steps s ON s.id=q.step_id
    JOIN users u ON u.id=q.user_id JOIN school_subscriptions sc ON sc.school_id=u.school_id
    WHERE q.delivery_status='PENDING' AND q.attempts<5 AND s.enabled
    AND q.scheduled_at<=now() AND q.next_attempt_at<=now()
    AND (q.claimed_until IS NULL OR q.claimed_until<=now())
    AND u.status='ACTIVE' AND sc.deletion_requested_at IS NULL AND sc.closed_at IS NULL AND sc.status<>'TERMINATED'
    ORDER BY q.scheduled_at,q.id LIMIT 50`,
  );
  for (const candidate of candidates) {
    const claim = token();
    const queued = await one(
      db,
      `UPDATE onboarding_email_queue q SET claim_token=$2,claimed_until=now()+interval '5 minutes'
      WHERE q.id=$1 AND q.delivery_status='PENDING' AND q.attempts<5
      AND q.scheduled_at<=now() AND q.next_attempt_at<=now() AND (q.claimed_until IS NULL OR q.claimed_until<=now())
      AND EXISTS(SELECT 1 FROM onboarding_email_steps s WHERE s.id=q.step_id AND s.enabled)
      AND EXISTS(SELECT 1 FROM users u JOIN school_subscriptions sc ON sc.school_id=u.school_id
        WHERE u.id=q.user_id AND u.status='ACTIVE' AND sc.deletion_requested_at IS NULL AND sc.closed_at IS NULL AND sc.status<>'TERMINATED')
      RETURNING q.*`,
      [candidate.id, claim],
    );
    if (!queued) continue;
    try {
      const user = await one(
        db,
        "SELECT u.*,c.name AS school_name,c.portal_slug FROM users u JOIN schools c ON c.id=u.school_id WHERE u.id=$1",
        [queued.user_id],
      );
      const step = await one(
        db,
        "SELECT template_key FROM onboarding_email_steps WHERE id=$1",
        [queued.step_id],
      );
      await send(
        smtp,
        await renderEmail(db, step.template_key, valuesFor(user)),
        user,
      );
      await db.query(
        "UPDATE onboarding_email_queue SET delivery_status='SENT',sent_at=now(),claim_token=NULL,claimed_until=NULL WHERE id=$1 AND claim_token=$2",
        [queued.id, claim],
      );
    } catch {
      await db.query(
        `UPDATE onboarding_email_queue SET attempts=attempts+1,
        delivery_status=CASE WHEN attempts>=4 THEN 'FAILED' ELSE 'PENDING' END,
        next_attempt_at=now()+interval '5 minutes',claim_token=NULL,claimed_until=NULL
        WHERE id=$1 AND claim_token=$2`,
        [queued.id, claim],
      );
    }
  }
}

export function onboardingEmailRoutes(db) {
  const router = express.Router();
  const base = "/saas/owner/onboarding-emails";
  router.use(base, requireOwner);
  const id = z.coerce.number().int().positive();
  router.get(base, async (req, res) => {
    const steps = await rows(
      db,
      `SELECT s.*,t.subject,t.body FROM onboarding_email_steps s
      LEFT JOIN platform_email_templates t ON t.key=s.template_key ORDER BY s.delay_minutes,s.id`,
    );
    const queue = await rows(
      db,
      `SELECT q.*,s.name AS step_name,s.enabled,u.name AS user_name,u.email,c.name AS school_name
      FROM onboarding_email_queue q JOIN onboarding_email_steps s ON s.id=q.step_id
      JOIN users u ON u.id=q.user_id JOIN schools c ON c.id=u.school_id ORDER BY q.created_at DESC,q.id DESC LIMIT 50`,
    );
    const counts = await rows(
      db,
      "SELECT delivery_status,count(*)::int AS count FROM onboarding_email_queue GROUP BY delivery_status",
    );
    res.json({
      data: {
        steps: steps.map((s) => ({
          ...s,
          subject: s.subject ?? emailTemplates[s.template_key]?.subject ?? "",
          body: s.body ?? emailTemplates[s.template_key]?.body ?? "",
          variables,
        })),
        queue,
        counts,
      },
    });
  });
  const save = async (req, res, existingId = null) => {
    const b = validateDefinition(req.body);
    const result = await db.transaction(async (tx) => {
      const before = existingId
        ? await one(
            tx,
            "SELECT * FROM onboarding_email_steps WHERE id=$1 FOR UPDATE",
            [existingId],
          )
        : null;
      if (existingId && !before) fail(404, "Onboarding step not found.");
      const step = before
        ? await one(
            tx,
            "UPDATE onboarding_email_steps SET name=$2,delay_minutes=$3,enabled=$4,updated_by=$5,updated_at=now() WHERE id=$1 RETURNING *",
            [existingId, b.name, b.delay_minutes, b.enabled, req.user.id],
          )
        : await insert(tx, "onboarding_email_steps", {
            name: b.name,
            template_key: `onboarding_custom_${token().slice(0, 12)}`,
            delay_minutes: b.delay_minutes,
            enabled: b.enabled,
            updated_by: req.user.id,
          });
      await tx.query(
        "INSERT INTO platform_email_templates(key,subject,body,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_by=EXCLUDED.updated_by,updated_at=now()",
        [step.template_key, b.subject, b.body, req.user.id],
      );
      if (before)
        await tx.query(
          `UPDATE onboarding_email_queue q SET scheduled_at=u.created_at+$2::int*interval '1 minute'
        FROM users u WHERE q.user_id=u.id AND q.step_id=$1 AND q.delivery_status='PENDING'
        AND (q.claimed_until IS NULL OR q.claimed_until<=now())`,
          [step.id, b.delay_minutes],
        );
      await audit(
        tx,
        req.user,
        "onboarding_email_steps",
        step.id,
        before ? "ONBOARDING_STEP_UPDATED" : "ONBOARDING_STEP_CREATED",
        before,
        b,
      );
      return step;
    });
    res.status(existingId ? 200 : 201).json({
      data: {
        ...result,
        message:
          "Onboarding email saved. Enabled steps are queued automatically for new school registrations.",
      },
    });
  };
  router.post(base + "/steps", (req, res) => save(req, res));
  router.patch(base + "/steps/:id", (req, res) =>
    save(req, res, id.parse(req.params.id)),
  );
  router.get(base + "/steps/:id/preview", async (req, res) => {
    const step = await one(
      db,
      "SELECT template_key FROM onboarding_email_steps WHERE id=$1",
      [id.parse(req.params.id)],
    );
    if (!step) fail(404, "Onboarding step not found.");
    const message = await renderEmail(
      db,
      step.template_key,
      valuesFor({
        name: "School Administrator",
        school_name: "Your School",
        portal_slug: "your-school",
      }),
    );
    res.json({
      data: {
        subject: message.subject,
        html: message.html.replace(
          "cid:smpis-brand",
          `data:image/png;base64,${message.attachments[0].content.toString("base64")}`,
        ),
      },
    });
  });
  router.post(base + "/queue/:id/retry", async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const queued = await one(
        tx,
        "UPDATE onboarding_email_queue SET delivery_status='PENDING',attempts=0,next_attempt_at=now(),claim_token=NULL,claimed_until=NULL WHERE id=$1 AND delivery_status='FAILED' RETURNING *",
        [id.parse(req.params.id)],
      );
      if (!queued) fail(422, "Only failed onboarding emails can be retried.");
      await audit(
        tx,
        req.user,
        "onboarding_email_queue",
        queued.id,
        "ONBOARDING_EMAIL_RETRIED",
      );
      return queued;
    });
    res.json({ data: { ...result, message: "Email queued for retry." } });
  });
  return router;
}
