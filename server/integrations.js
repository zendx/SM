import express from "express";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { one, audit } from "./db.js";
import { fail } from "./security.js";

const value = z.string().trim().max(2000).default("");
const secret = z.string().max(4000).default("");
export const integrationDefinitions = {
  smtp: { secrets: ["password"], schema: z.object({ enabled: z.boolean(), host: value, port: z.coerce.number().int().min(1).max(65535).default(587), secure: z.boolean().default(false), username: value, password: secret, from: value }) },
  paystack: { secrets: ["secret_key"], schema: z.object({ enabled: z.boolean(), public_key: value, secret_key: secret, live_enabled: z.boolean().default(false) }) },
  flutterwave: { secrets: ["secret_key", "webhook_secret"], schema: z.object({ enabled: z.boolean(), public_key: value, secret_key: secret, webhook_secret: secret }) },
  twilio: { secrets: ["auth_token"], schema: z.object({ enabled: z.boolean(), account_sid: value, auth_token: secret, from: value, messaging_service_sid: value }) },
};
function encryptionKey() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_ENCRYPTION_KEY || ""))
    fail(503, "Set INTEGRATION_ENCRYPTION_KEY to a 64-character hexadecimal key on the server before saving integrations.");
  return Buffer.from(process.env.INTEGRATION_ENCRYPTION_KEY, "hex");
}
function encrypt(config, schoolId, provider) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${schoolId}:${provider}`));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(b => b.toString("base64")).join(".");
}
export async function integrationConfig(db, schoolId, provider) {
  const record = await one(db, "SELECT encrypted_config FROM school_integrations WHERE school_id=$1 AND provider=$2", [schoolId, provider]);
  if (!record) return null;
  try {
    const [iv, tag, bytes] = record.encrypted_config.split(".").map(v => Buffer.from(v, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`${schoolId}:${provider}`)); cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString("utf8"));
  } catch { fail(503, "Integration credentials could not be decrypted. Check the server encryption key."); }
}
function redact(provider, config) {
  const result = { ...config };
  for (const field of integrationDefinitions[provider].secrets) { result[`${field}_configured`] = !!result[field]; delete result[field]; }
  return result;
}
function validate(provider, c) {
  if (!c.enabled) return;
  const required = { smtp: ["host", "from"], paystack: ["secret_key"], flutterwave: ["public_key", "secret_key"], twilio: ["account_sid", "auth_token"] }[provider];
  if (required.some(k => !c[k])) fail(422, "Complete the required provider details before enabling this integration.");
  if (provider === "smtp" && (!z.string().email().safeParse(c.from).success || /[\s/:]/.test(c.host))) fail(422, "Enter a valid SMTP hostname and sender email.");
  if (provider === "smtp" && c.username && !c.password) fail(422, "An SMTP password is required when a username is provided.");
  if (provider === "paystack" && !/^sk_(test|live)_\S+$/.test(c.secret_key)) fail(422, "Enter a valid Paystack secret key.");
  if (provider === "twilio" && (!/^AC[a-f0-9]{32}$/i.test(c.account_sid) || (!c.from && !c.messaging_service_sid))) fail(422, "Enter a valid Twilio account SID and sender or messaging service SID.");
}
export function integrationRoutes(db) {
  const r = express.Router();
  r.use("/admin/integrations", (req, res, next) => {
    if (req.user.role !== "SUPER_ADMIN") fail(403, "Only super administrators can manage integration credentials.", "FORBIDDEN");
    next();
  });
  r.get("/admin/integrations", async (req, res) => {
    const data = {};
    for (const provider of Object.keys(integrationDefinitions)) data[provider] = redact(provider, await integrationConfig(db, req.user.school_id, provider) || { enabled: false });
    res.json({ data });
  });
  r.patch("/admin/integrations/:provider", async (req, res) => {
    const provider = z.enum(["smtp", "paystack", "flutterwave", "twilio"]).parse(req.params.provider);
    const definition = integrationDefinitions[provider];
    const body = definition.schema.extend({ clear_secrets: z.array(z.enum(definition.secrets)).default([]) }).strict().parse(req.body);
    const { clear_secrets, ...config } = body;
    await db.transaction(async tx => {
      await tx.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [req.user.school_id]);
      const before = await integrationConfig(tx, req.user.school_id, provider);
      for (const field of definition.secrets) config[field] = clear_secrets.includes(field) ? "" : config[field] || before?.[field] || "";
      validate(provider, config);
      await tx.query("INSERT INTO school_integrations(school_id,provider,encrypted_config) VALUES($1,$2,$3) ON CONFLICT(school_id,provider) DO UPDATE SET encrypted_config=EXCLUDED.encrypted_config,updated_at=now()", [req.user.school_id, provider, encrypt(config, req.user.school_id, provider)]);
      await audit(tx, req.user, "school_integrations", req.user.school_id, "UPDATE", before ? redact(provider, before) : null, { provider, ...redact(provider, config) });
    });
    res.json({ data: redact(provider, config) });
  });
  return r;
}
export async function smtpConfig(db, schoolId) {
  const saved = await integrationConfig(db, schoolId, "smtp");
  if (saved) return saved.enabled ? { transport: { host: saved.host, port: saved.port, secure: saved.secure, ...(saved.username ? { auth: { user: saved.username, pass: saved.password } } : {}) }, from: saved.from } : null;
  return process.env.SMTP_URL && process.env.MAIL_FROM ? { transport: process.env.SMTP_URL, from: process.env.MAIL_FROM } : null;
}
