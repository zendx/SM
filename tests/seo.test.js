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
    if (route === "/") {
      assert.match(
        html,
        /<title>School Management Software for Growing Schools \| SMPIS<\/title>/,
      );
      assert.match(html, /<h1>A calmer, smarter way to run your school\.<\/h1>/);
      assert.match(html, /href="\/signup">Start your 30-day free trial<\/a>/);
      assert.match(
        html,
        /<footer><a href="https:\/\/maidensail\.com\/startup\/smpis" rel="dofollow"><img src="https:\/\/maidensail\.com\/badge\/smpis\.svg"/,
      );
    }
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
    assert.doesNotMatch(html, /name="robots" content="noindex/);
    assert.equal(
      renderSeoHtml(html, route, "https://school.example.com"),
      html,
    );
  }
  const signup = renderSeoHtml(
    template,
    "/signup",
    "https://school.example.com",
  );
  assert.match(signup, /<meta name="robots" content="noindex, follow"/);
  assert.match(
    signup,
    /rel="canonical" href="https:\/\/school\.example\.com\/signup"/,
  );
  assert.doesNotMatch(signup, /application\/ld\+json/);
  assert.doesNotMatch(
    renderSeoHtml(template, "/index.html", "https://school.example.com"),
    /name="robots" content="noindex/,
  );
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
  const robots = await fetch(
    `http://127.0.0.1:${server.address().port}/robots.txt`,
  );
  assert.equal(robots.status, 200);
  assert.match(
    await robots.text(),
    /Sitemap: https:\/\/school\.example\.com\/sitemap\.xml/,
  );
  const sitemap = await fetch(
    `http://127.0.0.1:${server.address().port}/sitemap.xml`,
  );
  assert.equal(sitemap.status, 200);
  const xml = await sitemap.text();
  assert.match(xml, /https:\/\/school\.example\.com\//);
  assert.match(xml, /https:\/\/school\.example\.com\/privacy/);
  assert.doesNotMatch(xml, /\/signup/);
});
