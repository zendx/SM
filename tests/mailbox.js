import nodemailer from "nodemailer";
import assert from "node:assert/strict";

// Registration fixtures complete the same email-link flow as real users.
export function testMailbox() {
  process.env.APP_URL = "https://smpis.test";
  process.env.SMTP_URL = "smtp://mail.test";
  process.env.MAIL_FROM = "accounts@smpis.test";
  const messages = new Map();
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      if (message.subject === "Verify your SMPIS email")
        messages.set(message.to, message);
    },
  });
  return async (email, base) => {
    const message = messages.get(email);
    if (!message) return;
    const token = new URL(
      message.text.match(/https:\/\/\S+/)[0].replace(/\.$/, ""),
    ).searchParams.get("verify");
    const response = await fetch(base + "/auth/email-verification/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(response.status, 200, await response.text());
    messages.delete(email);
  };
}
