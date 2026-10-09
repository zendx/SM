import assert from "node:assert/strict";
import { test as unitTest } from "node:test";
import { test, openTestDatabase } from "./database.js";
import { screenRegistrationEmail } from "../server/stopreg.js";
import { createApp } from "../server/app.js";
import { one } from "../server/db.js";
import nodemailer from "nodemailer";

const result = (overrides = {}) => ({
  status: 200,
  data: {
    classification: {
      is_disposable: false,
      is_public: true,
      is_role_based: true,
    },
    list_match: { blocklisted: false },
    policy: { action: "allow" },
    ...overrides,
  },
});
const requestFor = (body) => async () =>
  new Response(JSON.stringify(body), { status: 200 });

// Observed live API envelope: HTTP 200, no body status or list_match.
const liveResult = (action = "allow") => ({
  message: "Success",
  description: "Email verification completed.",
  data: {
    classification: { is_disposable: false, is_public: true },
    policy: { action, reason_code: "UNKNOWN", risk: "low" },
  },
});

unitTest("StopReg accepts the live response envelope and enforces its policy", async () => {
  await screenRegistrationEmail("admin@school.test", {
    apiToken: "fake-test-token",
    request: requestFor(liveResult()),
  });
  for (const action of ["warn", "block"])
    await assert.rejects(
      screenRegistrationEmail("admin@school.test", {
        apiToken: "fake-test-token",
        request: requestFor(liveResult(action)),
      }),
      (error) => error.status === 422 && error.code === "EMAIL_FLAGGED",
    );
});

unitTest(
  "StopReg keeps credentials server-side and accepts legitimate public/role-based emails",
  async () => {
    await screenRegistrationEmail("admin+school@gmail.com", {
      apiToken: "fake-test-token",
      request: async (url, options) => {
        assert.equal(
          url,
          "https://api.stopreg.com/api/v1/verify/email/admin%2Bschool%40gmail.com",
        );
        assert.equal(options.headers["x-api-token"], "fake-test-token");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal);
        return new Response(JSON.stringify(result()));
      },
    });
    await screenRegistrationEmail("admin@school.test", {
      apiToken: "",
      request: () => {
        throw new Error("Must not call API without a token");
      },
    });
  },
);
unitTest(
  "StopReg blocks disposable, blocklisted and policy-flagged email with clean reasons",
  async () => {
    for (const [data, code, message] of [
      [
        result({ classification: { is_disposable: true } }),
        "DISPOSABLE_EMAIL",
        /disposable or temporary/,
      ],
      [
        result({ list_match: { blocklisted: true } }),
        "EMAIL_BLOCKED",
        /domain is blocked/,
      ],
      [result({ policy: { action: "warn" } }), "EMAIL_FLAGGED", /flagged/],
      [result({ policy: { action: "block" } }), "EMAIL_FLAGGED", /flagged/],
    ])
      await assert.rejects(
        screenRegistrationEmail("signup@test.com", {
          apiToken: "fake-test-token",
          request: requestFor(data),
        }),
        (e) => e.status === 422 && e.code === code && message.test(e.message),
      );
  },
);
unitTest(
  "StopReg outages, quota failures, invalid tokens and malformed results never allow signup",
  async () => {
    for (const request of [
      async () => {
        throw new Error("secret-provider-url");
      },
      async () => {
        throw new DOMException("Timeout", "TimeoutError");
      },
      async () => new Response("secret", { status: 429 }),
      async () => new Response("secret", { status: 401 }),
      async () => new Response("not-json"),
      requestFor({ status: 200, data: {} }),
      requestFor({ ...liveResult(), status: 500 }),
      requestFor({ data: { classification: { is_disposable: false } } }),
      requestFor(result({ list_match: { blocklisted: "false" } })),
      requestFor(result({ classification: { is_disposable: "false" } })),
    ])
      await assert.rejects(
        screenRegistrationEmail("signup@test.com", {
          apiToken: "fake-test-token",
          request,
        }),
        (e) =>
          e.status === 503 &&
          e.code === "EMAIL_SCREENING_UNAVAILABLE" &&
          !e.message.includes("secret"),
      );
  },
);

test("registration rejects screened email before any database records or verification emails are created", async () => {
  const db = await openTestDatabase();
  const originalFetch = globalThis.fetch,
    originalTransport = nodemailer.createTransport;
  const saved = Object.fromEntries(
    ["STOPREG_API_TOKEN", "APP_URL", "SMTP_URL", "MAIL_FROM"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  Object.assign(process.env, {
    STOPREG_API_TOKEN: "fake-test-token",
    APP_URL: "https://smpis.test",
    SMTP_URL: "smtp://mail.test",
    MAIL_FROM: "accounts@smpis.test",
  });
  let check = result({ classification: { is_disposable: true } }),
    mailCount = 0,
    apiCalls = 0;
  globalThis.fetch = (url, options) =>
    String(url).startsWith("https://api.stopreg.com/")
      ? (apiCalls++, requestFor(check)(url, options))
      : originalFetch(url, options);
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      mailCount++;
    },
  });
  const server = (await createApp(db)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function post(path, body) {
    const res = await originalFetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json()) };
  }
  try {
    const owner = {
      name: "Owner",
      email: "owner@test.com",
      password: "StopReg-signup-2026!",
    };
    assert.equal((await post("/auth/owner/setup", owner)).status, 422);
    assert.equal((await one(db, "SELECT count(*)::int AS n FROM users")).n, 0);
    assert.equal(mailCount, 0);
    check = liveResult();
    assert.equal((await post("/auth/owner/setup", owner)).status, 201);
    assert.equal(mailCount, 1);
    const signup = {
      school_name: "Test School",
      portal_slug: "stopreg-school",
      phone_number: "+2348012345678",
      name: "Admin",
      email: "school@test.com",
      password: owner.password,
      plan: "FREE",
      year_name: "2026",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    };
    check = result({ classification: { is_disposable: true } });
    const refused = await post("/saas/register", signup);
    assert.equal(refused.status, 422);
    assert.equal(refused.errors[0].code, "DISPOSABLE_EMAIL");
    assert.match(
      refused.errors[0].message,
      /permanent personal or school email/,
    );
    assert.equal(
      (await one(db, "SELECT count(*)::int AS n FROM schools")).n,
      0,
    );
    assert.equal(mailCount, 1);
    check = { status: 500 };
    assert.equal((await post("/saas/register", signup)).status, 503);
    assert.equal(
      (await one(db, "SELECT count(*)::int AS n FROM schools")).n,
      0,
    );
    check = result();
    assert.equal((await post("/saas/register", signup)).status, 201);
    assert.equal(mailCount, 2);
    assert.equal(apiCalls, 5);
  } finally {
    globalThis.fetch = originalFetch;
    nodemailer.createTransport = originalTransport;
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
