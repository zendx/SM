import nodemailer from "nodemailer";
import { smtpConfig } from "./integrations.js";
import { insert } from "./db.js";
import { token, digest, fail } from "./security.js";
import { renderEmail } from "./email-templates.js";

export async function verificationMailer(db) {
  const smtp = await smtpConfig(db, null);
  if (!smtp || !process.env.APP_URL)
    fail(
      503,
      "Registration email is not configured. Contact the platform owner.",
    );
  return { smtp, url: new URL("/login", process.env.APP_URL) };
}

export async function sendVerification(db, user, mailer = null) {
  const { smtp, url } = mailer || (await verificationMailer(db));
  const raw = token();
  await insert(db, "email_verification_tokens", {
    token_hash: digest(raw),
    user_id: user.id,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  url.searchParams.set("verify", raw);
  const message = {
    from: smtp.from,
    to: user.email,
    ...(await renderEmail(db, "verification", {
      name: user.name,
      link: url.href,
    })),
  };
  try {
    await nodemailer.createTransport(smtp.transport).sendMail(message);
  } catch (error) {
    // Keep credentials, recipients, verification links and raw SMTP replies private.
    console.error("Verification email delivery failed", {
      code: /^[A-Z_]{1,40}$/.test(error.code || "") ? error.code : "SMTP_ERROR",
      responseCode: Number.isInteger(error.responseCode)
        ? error.responseCode
        : null,
      unauthorizedIP: /unauthorized ip/i.test(error.response || ""),
    });
    fail(
      503,
      "We couldn't send your verification email right now. Please try again shortly or contact SMPIS support.",
      "EMAIL_VERIFICATION_UNAVAILABLE",
    );
  }
}
