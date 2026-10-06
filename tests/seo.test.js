import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { renderSeoHtml, siteOrigin } from "../server/seo.js";
import { serveFrontend } from "../server/frontend.js";

test("public HTML contains crawlable SEO metadata and a visible primary heading", async () => {
  const template = await readFile("index.html", "utf8");
  for (const route of ["/", "/privacy", "/terms", "/cookies", "/privacy/"]) {
    const html = renderSeoHtml(template, route, "https://school.example.com");
    const canonical = `https://school.example.com${route.replace(/\/$/, "") || "/"}`;
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    for (const property of ["title", "description", "url"])
      assert.match(
        html,
        new RegExp(`<meta property="og:${property}" content="[^\"]+"`),
      );
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    const schema = JSON.parse(
      html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
      )[1],
    );
    assert.equal(schema.url, canonical);
    assert.equal(schema["@context"], "https://schema.org");
    assert.equal(schema["@type"], route === "/" ? "WebApplication" : "WebPage");
    assert.equal(
      renderSeoHtml(html, route, "https://school.example.com"),
      html,
    );
  }
});

test("canonical origin comes from configuration and rejects unsafe deployment URLs", () => {
  assert.equal(
    siteOrigin({ APP_URL: "https://school.example.com/path?reset=secret" }),
    "https://school.example.com",
  );
  assert.equal(
    siteOrigin({
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL: "school.example.com",
    }),
    "https://school.example.com",
  );
  for (const APP_URL of [
    "javascript:alert(1)",
    "https://user:secret@school.example.com",
    "http://school.example.com",
  ])
    assert.throws(() => siteOrigin({ VERCEL: "1", APP_URL }));
  assert.throws(() => siteOrigin({ VERCEL: "1" }), /APP_URL/);
});

test("server returns page-specific SEO without JavaScript or trusting Host headers", async (t) => {
  const directory = path.resolve("test-results/seo");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.html"),
    renderSeoHtml(
      await readFile("index.html", "utf8"),
      "/",
      "https://school.example.com",
    ),
  );
  const app = express();
  serveFrontend(app, directory, { origin: "https://school.example.com" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/privacy?reset=private`,
    { headers: { Host: "untrusted.example.com" } },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Privacy Policy \| SMPIS<\/title>/);
  assert.match(html, /<h1>Privacy policy<\/h1>/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/school.example.com\/privacy"/,
  );
  assert.ok(!html.includes("untrusted.example.com"));
  assert.ok(!html.includes("reset=private"));
});
