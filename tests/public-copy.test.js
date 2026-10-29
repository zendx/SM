import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

let server, publicPages, legal;
before(async () => {
  const browser = new JSDOM("", { url: "https://school.test/" });
  globalThis.location = browser.window.location;
  server = await createServer({
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });
  publicPages = await server.ssrLoadModule("/src/pages/saas-public.jsx");
  legal = await server.ssrLoadModule("/src/pages/legal.jsx");
});
after(async () => {
  await server?.close();
  delete globalThis.location;
});

test("public pricing waits for configured plan data and does not display fallback prices", () => {
  const html = renderToStaticMarkup(React.createElement(publicPages.Landing));
  const document = new JSDOM(html).window.document;
  for (const price of document.querySelectorAll(".plan-price"))
    assert.doesNotMatch(price.textContent, /[$₦]\s*\d/);
  assert.doesNotMatch(
    html,
    /Featured on|maidensail|All modules included|calmer, smarter/,
  );
  assert.ok(
    [...document.images].every(
      (image) => !/^https?:\/\//.test(image.getAttribute("src")),
    ),
  );
  const signup = renderToStaticMarkup(React.createElement(publicPages.Signup));
  assert.doesNotMatch(signup, /\$100|\$1,020/);
  assert.equal(
    new JSDOM(signup).window.document.querySelector("form"),
    null,
    "Signup must wait for plan configuration instead of using sample prices",
  );
});

test("cookie information has no acceptance action or optional notice cookie", () => {
  const html = renderToStaticMarkup(React.createElement(legal.CookieNotice));
  const document = new JSDOM(html).window.document;
  assert.deepEqual(
    [...document.querySelectorAll("button")].map(
      (button) => button.textContent,
    ),
    ["Dismiss notice"],
  );
  const policy = renderToStaticMarkup(
    React.createElement(legal.LegalPage, { type: "cookies" }),
  );
  assert.match(policy, /smpis_session/);
  assert.match(policy, /8 hours/);
  assert.match(policy, /_GRECAPTCHA/);
  assert.match(policy, /no longer creates a cookie/);
});

test("public family and referral descriptions disclose the actual access and payment limits", async () => {
  const { productModules } = await import("../server/product-catalog.js");
  const { MARKETER_TERMS } = await import("../shared/marketer-terms.js");
  const family = productModules.find(
    (module) => module.slug === "family-portal",
  );
  assert.match(
    family.note,
    /school administrators and parents in their own school/,
  );
  assert.match(family.note, /does not provide device push notifications/);
  const timeline = MARKETER_TERMS.find(
    (term) => term.title === "Payment timeline",
  ).body;
  assert.match(timeline, /outside SMPIS/);
  assert.match(timeline, /does not guarantee/);
});
