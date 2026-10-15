import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { createApp } from "../server/app.js";

test("signup and both login routes enforce CAPTCHA without exposing the secret", async () => {
  const previous = {
    site: process.env.RECAPTCHA_SITE_KEY,
    secret: process.env.RECAPTCHA_SECRET_KEY,
  };
  const originalFetch = globalThis.fetch;
  let verification;
  globalThis.fetch = (url, options) =>
    url === "https://www.google.com/recaptcha/api/siteverify"
      ? Promise.resolve(Response.json(verification))
      : originalFetch(url, options);
  const db = await openTestDatabase();
  process.env.RECAPTCHA_SITE_KEY = "public-site-key";
  process.env.RECAPTCHA_SECRET_KEY = "private-secret-key";
  const server = (await createApp(db, { production: true })).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const config = await fetch(base + "/auth/recaptcha");
    assert.deepEqual(await config.json(), {
      data: { siteKey: "public-site-key" },
    });
    assert.equal(config.headers.get("cache-control"), "no-store");
    assert.match(
      config.headers.get("content-security-policy"),
      /https:\/\/www.gstatic.com\/recaptcha\//,
    );
    for (const path of ["/auth/login", "/auth/owner/login", "/saas/register"]) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 422, path);
      assert.equal(
        (await response.json()).errors[0].code,
        "RECAPTCHA_REQUIRED",
        path,
      );
    }
    for (const [path, action] of [
      ["/auth/login", "login"],
      ["/auth/owner/login", "owner_login"],
      ["/saas/register", "signup"],
    ]) {
      const submit = () =>
        fetch(base + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recaptcha_token: "token",
            recaptcha_action: action,
          }),
        });
      verification = { success: true, score: 0.9, action: "wrong_action" };
      assert.equal(
        (await (await submit()).json()).errors[0].code,
        "RECAPTCHA_FAILED",
        path,
      );
      verification = { success: true, score: 0.1, action };
      assert.equal(
        (await (await submit()).json()).errors[0].code,
        "RECAPTCHA_FAILED",
        path,
      );
      verification = { success: true, score: 0.9, action };
      // Valid verification reaches normal form validation (required account fields are missing).
      assert.equal(
        (await (await submit()).json()).errors[0].code,
        "VALIDATION_ERROR",
        path,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    for (const [key, value] of [
      ["RECAPTCHA_SITE_KEY", previous.site],
      ["RECAPTCHA_SECRET_KEY", previous.secret],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
