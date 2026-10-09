import nodemailer from "nodemailer";
import { one } from "./db.js";
import { smtpConfig } from "./integrations.js";
import { renderEmail } from "./email-templates.js";

// Initial credentials stay in request memory; never put them in a durable queue.
export async function sendAccountCreatedEmail(db, user, initialPassword) {
  let transport;
  try {
    const smtp = await smtpConfig(db, user.school_id);
    if (!smtp || !process.env.APP_URL) return false;
    const school = await one(
      db,
      "SELECT name,portal_slug FROM schools WHERE id=$1",
      [user.school_id],
    );
    const message = await renderEmail(db, "account_created", {
      name: user.name,
      school_name: school.name,
      email: user.email,
      password: initialPassword,
      role: user.role.replaceAll("_", " "),
      link: new URL(`/${school.portal_slug}/`, process.env.APP_URL).href,
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
