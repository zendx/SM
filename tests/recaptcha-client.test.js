import assert from "node:assert/strict";
import { test } from "node:test";

test("v3 generates fresh tokens on submit and retries using the form's action", async () => {
  const originals = Object.fromEntries(
    ["window", "document", "location", "fetch"].map((key) => [
      key,
      globalThis[key],
    ]),
  );
  const executions = [];
  const scripts = [];
  let configured = true;
  let rejectExecution = false;
  globalThis.location = { pathname: "/login" };
  globalThis.window = {
    grecaptcha: {
      ready: (callback) => callback(),
      execute: async (key, { action }) => {
        executions.push({ key, action });
        if (rejectExecution) throw new Error("provider detail");
        return `fresh-token-${executions.length}`;
      },
    },
  };
  globalThis.document = {
    createElement: () => ({}),
    head: {
      appendChild: (script) => {
        scripts.push(script);
        queueMicrotask(() => script.onload());
      },
    },
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/v1/auth/recaptcha");
    return Response.json({
      data: { siteKey: configured ? "v3-public-key" : "" },
    });
  };
  try {
    const { recaptchaResponse } = await import("../src/recaptcha.js");
    assert.equal(
      scripts.length,
      0,
      "Importing the form helper must not load third-party scripts",
    );
    assert.deepEqual(await recaptchaResponse(false), {});
    assert.equal(scripts.length, 0);
    for (const [index, action] of [
      "login",
      "login",
      "signup",
      "owner_login",
    ].entries())
      assert.deepEqual(await recaptchaResponse(action), {
        recaptcha_token: `fresh-token-${index + 1}`,
      });
    assert.deepEqual(
      executions.map((entry) => entry.action),
      ["login", "login", "signup", "owner_login"],
    );
    assert.ok(executions.every((entry) => entry.key === "v3-public-key"));
    assert.equal(scripts.length, 1);
    assert.equal(
      scripts[0].src,
      "https://www.recaptcha.net/recaptcha/api.js?render=v3-public-key",
    );
    rejectExecution = true;
    await assert.rejects(
      recaptchaResponse("login"),
      /Human verification could not complete/,
    );
    rejectExecution = false;
    assert.deepEqual(await recaptchaResponse("login"), {
      recaptcha_token: "fresh-token-6",
    });
    configured = false;
    assert.deepEqual(await recaptchaResponse("signup"), {});
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
