import assert from "node:assert/strict";
import { test } from "node:test";
import { recaptchaConfig, verifyRecaptcha } from "../server/recaptcha.js";

const env = {
  RECAPTCHA_SITE_KEY: "public-key",
  RECAPTCHA_SECRET_KEY: "private-key",
};
test("reCAPTCHA is optional when unconfigured and rejects partial configuration", async () => {
  await verifyRecaptcha(undefined, {
    env: {},
    request: () => assert.fail("unexpected request"),
  });
  for (const partial of [
    { RECAPTCHA_SITE_KEY: "public" },
    { RECAPTCHA_SECRET_KEY: "secret" },
  ])
    assert.throws(
      () => recaptchaConfig(partial),
      (e) => e.status === 503,
    );
});
test("reCAPTCHA requires a bounded token before contacting Google", async () => {
  for (const token of [undefined, "", " ", {}, "a".repeat(4097)])
    await assert.rejects(
      verifyRecaptcha(token, {
        env,
        request: () => assert.fail("unexpected request"),
      }),
      (e) => e.code === "RECAPTCHA_REQUIRED",
    );
});
test("reCAPTCHA posts credentials privately and accepts successful verification", async () => {
  await verifyRecaptcha("user-token", {
    env,
    action: "login",
    request: async (url, options) => {
      assert.equal(url, "https://www.google.com/recaptcha/api/siteverify");
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("secret"), "private-key");
      assert.equal(options.body.get("response"), "user-token");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return Response.json({ success: true, score: 0.9, action: "login" });
    },
  });
});
test("v3 checks the server's expected action and numeric score threshold", async () => {
  for (const result of [
    { score: 0.49, action: "signup" },
    { score: 0.9, action: "login" },
    { score: "0.9", action: "signup" },
    { score: 1.1, action: "signup" },
    { score: -0.1, action: "signup" },
    { action: "signup" },
    { score: 0.9 },
    {},
  ])
    await assert.rejects(
      verifyRecaptcha("token", {
        env,
        action: "signup",
        request: async () => Response.json({ success: true, ...result }),
      }),
      (e) => e.code === "RECAPTCHA_FAILED",
    );
  for (const score of [0.5, 1])
    await verifyRecaptcha("token", {
      env,
      action: "signup",
      request: async () =>
        Response.json({ success: true, action: "signup", score }),
    });
  await assert.rejects(
    verifyRecaptcha("token", {
      env: { ...env, RECAPTCHA_MIN_SCORE: "0.8" },
      action: "signup",
      request: async () =>
        Response.json({ success: true, action: "signup", score: 0.7 }),
    }),
    (e) => e.code === "RECAPTCHA_FAILED",
  );
  await assert.rejects(
    verifyRecaptcha("token", {
      env,
      request: async () =>
        Response.json({ success: true, action: "signup", score: 0.9 }),
    }),
    (e) => e.code === "RECAPTCHA_FAILED",
  );
});
test("invalid score configuration fails closed", () => {
  for (const score of ["-1", "1.1", "NaN", "invalid", "Infinity"])
    assert.throws(
      () => recaptchaConfig({ ...env, RECAPTCHA_MIN_SCORE: score }),
      (e) => e.code === "RECAPTCHA_CONFIGURATION",
    );
});
test("reCAPTCHA rejects expired tokens and fails closed on provider errors", async () => {
  await assert.rejects(
    verifyRecaptcha("expired", {
      env,
      request: async () =>
        Response.json({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
    }),
    (e) => e.code === "RECAPTCHA_FAILED",
  );
  for (const request of [
    async () => {
      throw new Error("private-provider-detail");
    },
    async () => new Response("down", { status: 503 }),
    async () => Response.json({}),
    async () => new Response("invalid json"),
  ])
    await assert.rejects(
      verifyRecaptcha("token", { env, request }),
      (e) =>
        e.code === "RECAPTCHA_UNAVAILABLE" &&
        !e.message.includes("private-provider-detail"),
    );
});
