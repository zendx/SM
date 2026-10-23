import nodemailer from "nodemailer";

// Persist SMTP diagnostic codes only; provider response text can contain personal data.
export function emailErrorCode(error) {
  return (
    [error?.code, error?.responseCode, error?.command]
      .filter(Boolean)
      .map((value) =>
        String(value)
          .replace(/[^A-Za-z0-9_. -]/g, "")
          .slice(0, 50),
      )
      .join(" / ") || "DELIVERY_ERROR"
  );
}
export async function sendEmail(smtp, message) {
  let options = smtp.transport;
  const timeouts = {
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
  };
  if (typeof options === "string") {
    options = { url: options, ...timeouts };
  } else options = { ...options, ...timeouts };
  const transport = nodemailer.createTransport(options);
  try {
    const result = await transport.sendMail({ from: smtp.from, ...message });
    if (
      result?.rejected?.length ||
      (Array.isArray(result?.accepted) && !result.accepted.length)
    ) {
      const error = new Error("SMTP did not accept the recipient.");
      error.code = "RECIPIENT_REJECTED";
      throw error;
    }
    return result;
  } finally {
    transport.close?.();
  }
}
