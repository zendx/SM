import nodemailer from "nodemailer";
import { smtpConfig } from "./integrations.js";
import { insert } from "./db.js";
import { token, digest, fail } from "./security.js";

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
  await nodemailer.createTransport(smtp.transport).sendMail({
    from: smtp.from,
    to: user.email,
    subject: "Verify your SMPIS email",
    text: `Verify your email by opening ${url.href}. This link expires in 24 hours.`,
  });
}
