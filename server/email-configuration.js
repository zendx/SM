import { createBrevoTransport } from "./brevo-transport.js";

export function emailConfiguration(env = process.env) {
  const provider = (env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  if (!env.MAIL_FROM) return null;
  if (provider === "brevo")
    return env.BREVO_API_KEY
      ? {
          provider,
          transport: createBrevoTransport(env.BREVO_API_KEY),
          from: env.MAIL_FROM,
        }
      : null;
  if (provider === "smtp")
    return env.SMTP_URL
      ? { transport: env.SMTP_URL, from: env.MAIL_FROM }
      : null;
  throw Object.assign(new Error("EMAIL_PROVIDER must be smtp or brevo."), {
    code: "EMAIL_PROVIDER_INVALID",
  });
}

export function emailConfigurationStatus(env = process.env) {
  const provider = (env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  return {
    provider,
    configured:
      !!env.MAIL_FROM &&
      (provider === "brevo"
        ? !!env.BREVO_API_KEY
        : provider === "smtp" && !!env.SMTP_URL),
  };
}
