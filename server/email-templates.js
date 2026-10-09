import express from "express";
import { one } from "./db.js";
import { z } from "./validation.js";
import { fail } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { subscriptionEvent } from "./saas-service.js";
import { brandedEmail, emailLogo } from "./email-design.js";

export const emailTemplates = {
  subscription_reminder: {
    name: "Subscription reminder",
    direction: "Outbound",
    subject: "{{title}}",
    body: "{{body}}",
    variables: ["title", "body"],
  },
  verification: {
    name: "Email verification",
    direction: "Outbound",
    subject: "Verify your SMPIS email",
    body: "Hello {{name}},\n\nWelcome to SMPIS! Please verify your email address to finish setting up your account and start connecting your school.\n\n{{link}}\n\nThis verification link expires in 24 hours. If you didn’t create an account, you can ignore this email.",
    variables: ["name", "link"],
  },
  password_reset: {
    name: "Password reset",
    direction: "Outbound",
    subject: "Reset your SMPIS password",
    body: "Hello {{name}},\n\nWe received a request to reset your SMPIS password. Use the secure link below to choose a new password.\n\n{{link}}\n\nThis password reset link expires in 30 minutes. If you didn’t request it, you can ignore this email.",
    variables: ["name", "link"],
  },
  notification: {
    name: "Tenant announcement",
    direction: "Outbound",
    subject: "{{title}}",
    body: "{{body}}\n\nOpen {{link}}",
    variables: ["title", "body", "link"],
  },
  support_reply: {
    name: "Support reply to tenant",
    direction: "Outbound",
    subject: "{{title}}",
    body: "{{body}}\n\nOpen {{link}}",
    variables: ["title", "body", "link"],
  },
  support_received: {
    name: "Support ticket alert to owner and department",
    direction: "Inbound alerts",
    subject: "{{title}}",
    body: "{{body}}\n\nOpen {{link}}",
    variables: ["title", "body", "link"],
  },
  school_notification: {
    name: "School alerts and fee reminders",
    direction: "Outbound",
    subject: "{{title}}",
    body: "{{body}}\n\nOpen your school portal: {{link}}",
    variables: ["title", "body", "link"],
  },
  mfa_reminder: {
    name: "Account security reminder",
    direction: "Outbound",
    subject: "Secure your SMPIS account with two-factor authentication",
    body: "{{body}}\n\nOpen your account security settings: {{link}}",
    variables: ["body", "link"],
  },
};
export function renderTemplate(template, values) {
  const replace = (value) =>
    value.replace(/{{\s*(\w+)\s*}}/g, (_, key) => String(values[key] ?? ""));
  return {
    subject: replace(template.subject).replace(/[\r\n]/g, " "),
    text: replace(template.body),
  };
}
export async function renderEmail(db, key, values) {
  const template = await one(
    db,
    "SELECT subject,body FROM platform_email_templates WHERE key=$1",
    [key],
  );
  const message = renderTemplate(template || emailTemplates[key], values);
  return {
    ...message,
    html: brandedEmail({ ...message, link: values.link, key }),
    attachments: [await emailLogo()],
  };
}
export function emailTemplateRoutes(db) {
  const r = express.Router();
  r.get("/saas/owner/email-templates", requireOwner, async (req, res) => {
    const data = [];
    for (const [key, defaults] of Object.entries(emailTemplates))
      data.push({
        ...defaults,
        ...(await one(
          db,
          "SELECT subject,body,updated_at FROM platform_email_templates WHERE key=$1",
          [key],
        )),
        key,
      });
    res.json({ data });
  });
  r.patch(
    "/saas/owner/email-templates/:key",
    requireOwner,
    async (req, res) => {
      const key = req.params.key,
        defaults = emailTemplates[key];
      if (!Object.hasOwn(emailTemplates, key))
        fail(404, "Email template not found.");
      const b = z
        .object({
          subject: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .refine((v) => !/[\r\n]/.test(v)),
          body: z.string().trim().min(1).max(10000),
        })
        .strict()
        .parse(req.body);
      for (const field of [b.subject, b.body]) {
        const remaining = field.replace(/{{\s*(\w+)\s*}}/g, (_, variable) => {
          if (!defaults.variables.includes(variable))
            fail(422, `Unknown placeholder: ${variable}.`);
          return "";
        });
        if (remaining.includes("{{") || remaining.includes("}}"))
          fail(422, "Malformed template placeholder.");
      }
      for (const required of [
        ...(defaults.variables.includes("link") ? ["link"] : []),
        ...(defaults.variables.includes("body") ? ["body"] : []),
      ])
        if (!new RegExp(`{{\\s*${required}\\s*}}`).test(b.body))
          fail(422, `The message must include {{${required}}}.`);
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO platform_email_templates(key,subject,body,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET subject=EXCLUDED.subject,body=EXCLUDED.body,updated_by=EXCLUDED.updated_by,updated_at=now()",
          [key, b.subject, b.body, req.user.id],
        );
        await subscriptionEvent(
          tx,
          null,
          req.user.id,
          "EMAIL_TEMPLATE_UPDATED",
          { key },
        );
      });
      res.json({ data: { message: "Email template saved." } });
    },
  );
  return r;
}
