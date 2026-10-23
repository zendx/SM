import nodemailer from "nodemailer";
import { one, insert } from "./db.js";
import { token, digest } from "./security.js";
import { smtpConfig } from "./integrations.js";
import { renderEmail } from "./email-templates.js";

// A recipient chooses their password with a short-lived, single-use link.
export async function sendAccountCreatedEmail(db, user) {
  let transport;
  try {
    const smtp = await smtpConfig(db, user.school_id);
    if (!smtp || !process.env.APP_URL) return false;
    const school = await one(
      db,
      "SELECT name,portal_slug FROM schools WHERE id=$1",
      [user.school_id],
    );
    const raw = token();
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM reset_tokens WHERE user_id=$1", [user.id]);
      await insert(tx, "reset_tokens", {
        token_hash: digest(raw),
        user_id: user.id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
      });
    });
    const activation = new URL("/login", process.env.APP_URL);
    activation.searchParams.set("reset", raw);
    const message = await renderEmail(db, "account_created", {
      school_id: user.school_id,
      name: user.name,
      school_name: school.name,
      email: user.email,
      role: user.role.replaceAll("_", " "),
      link: activation.href,
      security_link: new URL(
        `/${school.portal_slug}/?security=mfa#administration`,
        process.env.APP_URL,
      ).href,
    });
    const timeouts = {
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    };
    let options = smtp.transport;
    if (typeof options === "string") {
      const url = new URL(options);
      for (const [key, value] of Object.entries(timeouts))
        url.searchParams.set(key, String(value));
      options = url.href;
    } else options = { ...options, ...timeouts };
    transport = nodemailer.createTransport(options);
    const result = await transport.sendMail({
      from: smtp.from,
      to: user.email,
      ...message,
    });
    return !result?.rejected?.length;
  } catch {
    // SMTP errors can contain the message itself, so never log them here.
    return false;
  } finally {
    transport?.close?.();
  }
}
