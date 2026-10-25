import { schoolSetupSteps } from "./school-setup-guide.js";
import { canonicalEmailLinks, emailFooter } from "./email-urls.js";
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
    body: "Hello {{name}},\n\nYour {{school_name}} account ({{role}}) is ready.\n\nEmail: {{email}}\n\nChoose your password and activate your account within 30 minutes: {{link}}\n\nIf the link expires, select Forgot your password? on the sign-in page to request a new one.\n\nSet up authenticator verification after activation: {{security_link}}",
    variables: [
      "name",
      "school_name",
      "role",
      "email",
      "link",
      "security_link",
    ],
  },
  onboarding_welcome: {
    name: "Welcome to your school portal",
    direction: "Onboarding",
    subject: "Welcome to SMPIS, {{name}}",
    body:
      "Hello {{name}},\n\nWelcome to SMPIS! Your {{school_name}} portal is ready. Follow the setup order below to prepare your school, exams, reports and fees.\n\nOpen your portal: {{link}}\n\nEnable two-factor authentication and save your recovery codes: {{security_link}}\n\nIf you have not verified your email, use your separate verification email first.\n\n" +
      schoolSetupSteps,
    variables: ["name", "school_name", "link", "security_link"],
  },
  onboarding_tour: {
    name: "Your SMPIS menu tour",
    direction: "Onboarding",
    subject: "A quick tour of your SMPIS school portal",
    body:
      "Hello {{name}},\n\nHere is your practical guide to {{school_name}} on SMPIS. Begin with Admissions and school setup, continue to Academics, then Finance. School configuration is under Administration.\n\nOpen your portal: {{link}}\n\n" +
      schoolSetupSteps +
      "\n\nOther menus and their purpose\n\n{{guide}}\n\nAccount security: {{security_link}}",
    variables: ["name", "school_name", "guide", "link", "security_link"],
  },
  auto_renewal_failed: {
    name: "Automatic renewal payment issue",
    direction: "Outbound",
    subject: "A quick update about your SMPIS renewal",
    body: "{{body}}\n\nReview your subscription: {{link}}",
    variables: ["title", "body", "link"],
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
export async function renderEmail(db, key, values, draft = null) {
  values = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string" ? canonicalEmailLinks(value) : value,
    ]),
  );
  if (key === "promotional_newsletter" && !emailLink(values.unsubscribe_link))
    fail(503, "Promotional email requires a working unsubscribe link.");
  const template =
    draft ||
    (await one(
      db,
      "SELECT subject,body FROM platform_email_templates WHERE key=$1",
      [key],
    ));
  const safeTemplate =
    key === "account_created" && /{{\s*password\s*}}/.test(template?.body || "")
      ? null
      : template;
  const rendered = renderTemplate(safeTemplate || emailTemplates[key], values);
  // Saved templates can predate the workflow update. Keep their content while
  // ensuring both existing and new registrations receive the current steps.
  if (
    ["onboarding_welcome", "onboarding_tour"].includes(key) &&
    !rendered.text.includes(schoolSetupSteps)
  ) {
    rendered.text += `\n\n${schoolSetupSteps}`;
  }

  const message = {
    subject: rendered.subject,
    text: canonicalEmailLinks(rendered.text),
  };
  const recipient = values.recipient_id
    ? await one(db, "SELECT name FROM users WHERE id=$1", [values.recipient_id])
    : null;
  const footer = emailFooter({
    key,
    recipientName: recipient?.name || values.name,
    recipientEmail: values.recipient_email,
  });

  const school = values.school_id
    ? await one(
        db,
        "SELECT name,portal_slug,logo_data FROM schools WHERE id=$1",
        [values.school_id],
      )
    : null;
  const schoolLogo = school?.logo_data?.match(
    /^data:(image\/(?:png|jpeg));base64,(.+)$/,
  );
  const attachments = [await emailLogo()];
  if (schoolLogo)
    attachments.push({
      filename:
        schoolLogo[1] === "image/png" ? "school-logo.png" : "school-logo.jpg",
      content: Buffer.from(schoolLogo[2], "base64"),
      contentType: schoolLogo[1],
      cid: "school-brand",
      contentDisposition: "inline",
      publicPath: `/email-school-logo/${encodeURIComponent(school.portal_slug)}`,
    });
  const plainText = `${school ? school.name + "\n\n" : ""}${message.text}\n\n${footer.recipient}\n\n${footer.reason}\n\nPlease do not reply to this automated email. For help, contact us.\nContact us: ${footer.contact} | Privacy Policy: ${footer.privacy}`;
  return {
    ...message,
    text: plainText,
    html: brandedEmail({
      ...message,
      footer,
      schoolName: school?.name,
      schoolLogo: Boolean(schoolLogo),
      link: values.link,
      key,
      unsubscribeLink: values.unsubscribe_link,
    }),
    attachments,
    ...(key === "promotional_newsletter" && values.unsubscribe_link
      ? {
          text: `${plainText}\n\nYou chose to receive SMPIS promotional emails. Unsubscribe: ${values.unsubscribe_link}`,
          headers: { "List-Unsubscribe": `<${values.unsubscribe_link}>` },
        }
      : {}),
  };
}
function validatedTemplate(key, body) {
  const defaults = emailTemplates[key];
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
    .parse(body);
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
    ...(key === "account_created" ? ["email", "security_link"] : []),
    ...(defaults.variables.includes("link") ? ["link"] : []),
    ...(defaults.variables.includes("body") ? ["body"] : []),
  ])
    if (!new RegExp(`{{\\s*${required}\\s*}}`).test(b.body))
      fail(422, `The message must include {{${required}}}.`);
  return b;
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
  r.post(
    "/saas/owner/email-templates/:key/preview",
    requireOwner,
    async (req, res) => {
      const key = req.params.key;
      const draft = validatedTemplate(key, req.body);
      const values = {
        name: "School Administrator",
        school_name: "Example Academy",
        email: "administrator@example.com",
        role: "Teacher",
        title: "An update from SMPIS",
        body:
          key === "auto_renewal_failed"
            ? "A small billing update: we were unable to charge your saved card. Please review your subscription and pay to continue using SMPIS."
            : "This is an example message. Actual recipient and school details will appear when the email is sent.",
        link: "https://example.com/school/#subscription",
        security_link: "https://example.com/school/#administration",
        unsubscribe_link: "https://example.com/?unsubscribe=preview",
        guide:
          "Open Administration to review your school settings, then add your team and classes.",
      };
      const message = await renderEmail(db, key, values, draft);
      res.json({
        data: {
          subject: message.subject,
          text: message.text,
          html: message.html.replace(
            "cid:smpis-brand",
            `data:image/png;base64,${message.attachments[0].content.toString("base64")}`,
          ),
        },
      });
    },
  );
  r.patch(
    "/saas/owner/email-templates/:key",
    requireOwner,
    async (req, res) => {
      const key = req.params.key;
      const b = validatedTemplate(key, req.body);
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
