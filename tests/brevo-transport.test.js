import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { createBrevoTransport } from "../server/brevo-transport.js";
import {
  emailConfiguration,
  emailConfigurationStatus,
} from "../server/email-configuration.js";
import { emailLogo } from "../server/email-design.js";

test("Brevo HTTPS delivers through existing Nodemailer flows with branded HTML and no SMTP connection", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://smpis.test";
  const requests = [];
  const adapter = createBrevoTransport("private-api-key", {
    request: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 201,
        json: async () => ({ messageId: "<brevo-test>" }),
      };
    },
  });
  try {
    const transport = nodemailer.createTransport({
      ...adapter,
      connectionTimeout: 15000,
    });
    const result = await transport.sendMail({
      from: "SMPIS <do-not-reply@smpis.digital>",
      to: "parent@example.test",
      subject: "School update",
      text: "Your school update",
      html: '<img src="cid:smpis-brand"><p>School update</p>',
      attachments: [await emailLogo()],
    });
    assert.deepEqual(result.accepted, ["parent@example.test"]);
    assert.equal(requests[0].url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(requests[0].options.headers["api-key"], "private-api-key");
    assert.equal(requests[0].options.redirect, "error");
    const payload = JSON.parse(requests[0].options.body);
    assert.deepEqual(payload.sender, {
      email: "do-not-reply@smpis.digital",
      name: "SMPIS",
    });
    assert.equal(
      payload.htmlContent,
      '<img src="https://smpis.test/email-logo.png"><p>School update</p>',
    );
    assert.equal(payload.textContent, "Your school update");
    assert.equal(payload.attachment, undefined);
    assert.ok(!JSON.stringify(adapter).includes("private-api-key"));
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
test("Brevo errors fail delivery without leaking provider responses and verification sends no email", async () => {
  let requested;
  const verified = nodemailer.createTransport(
    createBrevoTransport("secret", {
      request: async (url, options) => {
        requested = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: "private@test.invalid" }),
        };
      },
    }),
  );
  assert.equal(await verified.verify(), true);
  assert.equal(requested.url, "https://api.brevo.com/v3/account");
  assert.equal(requested.options.method, "GET");
  assert.equal(requested.options.body, undefined);
  for (const status of [400, 401, 429, 500]) {
    const transport = nodemailer.createTransport(
      createBrevoTransport("secret", {
        request: async () => ({
          ok: false,
          status,
          json: async () => ({ message: "sensitive provider response" }),
        }),
      }),
    );
    await assert.rejects(
      transport.sendMail({
        from: "sender@example.test",
        to: "recipient@example.test",
        subject: "Test",
        text: "Test",
      }),
      (error) =>
        error.code === `BREVO_HTTP_${status}` &&
        !error.message.includes("sensitive"),
    );
  }
  const invalid = nodemailer.createTransport(
    createBrevoTransport("secret", {
      request: async () => ({ ok: true, status: 201, json: async () => ({}) }),
    }),
  );
  await assert.rejects(
    invalid.sendMail({
      from: "sender@example.test",
      to: "recipient@example.test",
      subject: "Test",
      text: "Test",
    }),
    { code: "BREVO_INVALID_RESPONSE" },
  );
});
test("email provider configuration is explicit and never falls back to SMTP with missing Brevo credentials", () => {
  const env = {
    EMAIL_PROVIDER: "brevo",
    MAIL_FROM: "sender@example.test",
    SMTP_URL: "smtp://unused.test",
  };
  assert.equal(emailConfiguration(env), null);
  assert.equal(emailConfigurationStatus(env).configured, false);
  const configured = emailConfiguration({ ...env, BREVO_API_KEY: "secret" });
  assert.equal(configured.provider, "brevo");
  assert.equal(typeof configured.transport.send, "function");
  assert.deepEqual(
    emailConfiguration({
      MAIL_FROM: "sender@example.test",
      SMTP_URL: "smtp://mail.test",
    }),
    { from: "sender@example.test", transport: "smtp://mail.test" },
  );
  assert.throws(
    () => emailConfiguration({ ...env, EMAIL_PROVIDER: "unknown" }),
    { code: "EMAIL_PROVIDER_INVALID" },
  );
});
