import express from "express";
import { one } from "./db.js";
import { z } from "./validation.js";
import { fail } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { subscriptionEvent } from "./saas-service.js";
import { brandedEmail, emailLogo, emailLink } from "./email-design.js";

export const emailTemplates = {
  account_created: {
    name: "Tenant account created",
    direction: "Outbound",
    subject: "Your {{school_name}} portal account is ready",
    body: "Hello {{name}},\n\nYour administrator has created an account for you on the {{school_name}} SMPIS portal. Your role is {{role}}.\n\nUsername (email): {{email}}\nInitial password: {{password}}\n\nOpen your portal: {{link}}\n\nChoose your own password: on the sign-in page, select Forgot your password?, enter your email address, and use the reset email to set a new password. You can do this before your first sign-in or after signing out.\n\nSecure your account: sign in, open Administration > Security, and select Set up authenticator. Scan the QR code with your authenticator app, enter its code to enable MFA, and save your recovery codes somewhere safe.\n\nOpen Security settings: {{security_link}}\n\nKeep these sign-in details private. The menus available to you depend on your assigned role. Contact your school administrator if you need help.",
    variables: [
      "name",
      "school_name",
      "role",
      "email",
      "password",
      "link",
      "security_link",
    ],
  },
  onboarding_welcome: {
    name: "Welcome to your school portal",
    direction: "Onboarding",
    subject: "Welcome to SMPIS, {{name}}",
    body: "Hello {{name}},\n\nWelcome to SMPIS! Your {{school_name}} portal is ready, and we’re glad to have you here. Bring your school’s records, people and daily work together in one place.\n\nStart with Administration to review your school details and academic calendar, then add your team and students at your own pace.\n\nOpen your portal: {{link}}\n\nWhen you have a moment, enable two-factor authentication in Administration > Security. It adds a little extra protection to your account and your school’s records. Save your recovery codes somewhere safe.\n\nAccount security: {{security_link}}\n\nIf you haven’t verified your email yet, use the link in your separate verification email before signing in. Need a hand? The Support menu connects you with our team.",
    variables: ["name", "school_name", "link", "security_link"],
  },
  onboarding_tour: {
    name: "Your SMPIS menu tour",
    direction: "Onboarding",
    subject: "A quick tour of your SMPIS school portal",
    body: "Hello {{name}},\n\nHere’s a quick guide to finding your way around {{school_name}} on SMPIS. Verify your email, sign in, and choose the academic term at the top of your workspace.\n\n{{guide}}\n\nA good first session: review Administration, add classes and staff, enter your students, then explore attendance and finance. You can come back to this guide whenever you need it.\n\nOpen your portal: {{link}}\n\nFor a little extra peace of mind, enable two-factor authentication: {{security_link}}\n\nMenu access depends on each person’s role. Your team members may see fewer menus than the school administrator.",
    variables: ["name", "school_name", "guide", "link", "security_link"],
  },
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
  promotional_newsletter: {
    name: "Promotional email newsletter",
    direction: "Outbound",
    subject: "{{title}}",
    body: "{{body}}\n\nOpen SMPIS: {{link}}",
    variables: ["title", "body", "link"],
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
  if (key === "promotional_newsletter" && !emailLink(values.unsubscribe_link))
    fail(503, "Promotional email requires a working unsubscribe link.");
  const template = await one(
    db,
    "SELECT subject,body FROM platform_email_templates WHERE key=$1",
    [key],
  );
  const message = renderTemplate(template || emailTemplates[key], values);
  return {
    ...message,
    html: brandedEmail({
      ...message,
      link: values.link,
      key,
      credentialsText: key === "account_created" ? values.password : undefined,
      unsubscribeLink: values.unsubscribe_link,
    }),
    attachments: [await emailLogo()],
    ...(key === "promotional_newsletter" && values.unsubscribe_link
      ? {
          text: `${message.text}\n\nYou chose to receive SMPIS promotional emails. Unsubscribe: ${values.unsubscribe_link}`,
          headers: { "List-Unsubscribe": `<${values.unsubscribe_link}>` },
        }
      : {}),
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
        ...(key === "account_created"
          ? ["email", "password", "security_link"]
          : []),
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
