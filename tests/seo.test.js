import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  publicSeoPaths,
  renderRobots,
  renderSitemap,
  renderSeoHtml,
  siteOrigin,
} from "../server/seo.js";
import { serveFrontend } from "../server/frontend.js";

test("public HTML contains crawlable SEO metadata and a visible primary heading", async () => {
  const template = await readFile("index.html", "utf8");
  for (const route of ["/", "/privacy", "/terms", "/cookies", "/privacy/"]) {
    const html = renderSeoHtml(template, route, "https://school.example.com");
    const canonical = `https://school.example.com${route.replace(/\/$/, "") || "/"}`;
    assert.match(html, /<meta name="description" content="[^"]+"/);
    if (route === "/") {
      assert.match(html, /<title>School Management Software \| SMPIS<\/title>/);
      assert.match(html, /<h1>Less chasing records\. More time for your school\.<\/h1>/);
      assert.match(html, /href="\/signup">Start your 30-day free trial<\/a>/);
      assert.doesNotMatch(html, /maidensail|Featured on|calmer, smarter/);
    }
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    assert.ok(
      html.includes(
        '<meta property="og:image" content="https://school.example.com/assets/social-image.png"',
      ),
    );
    assert.ok(
      html.includes(
        '<meta name="twitter:image" content="https://school.example.com/assets/social-image.png"',
      ),
    );
    assert.ok(html.includes('<meta name="twitter:card" content="summary"'));
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
  for (const PUBLIC_SITE_URL of [
    "http://smpis.digital",
    "https://smpis.digital",
    "https://www.smpis.digital:8443",
  ]) {
    assert.equal(siteOrigin({ PUBLIC_SITE_URL }), "https://www.smpis.digital");
  }
  assert.equal(
    siteOrigin({ APP_URL: "https://smpis.digital" }),
    "https://www.smpis.digital",
  );
  assert.equal(
    siteOrigin({ APP_URL: "https://www.smpis.digital" }),
    "https://www.smpis.digital",
  );
  assert.equal(
    siteOrigin({
      APP_URL: "https://smpis.digital",
      PUBLIC_SITE_URL: "https://new.example.com",
    }),
    "https://new.example.com",
  );
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

test("production canonical, robots and sitemap consistently use the final www host", async () => {
  const origin = siteOrigin({ APP_URL: "https://smpis.digital" });
  const html = renderSeoHtml(await readFile("index.html", "utf8"), "/", origin);
  assert.ok(
    html.includes('<link rel="canonical" href="https://www.smpis.digital/"'),
  );
  assert.ok(
    html.includes(
      '<meta property="og:url" content="https://www.smpis.digital/"',
    ),
  );
  assert.doesNotMatch(html, /noindex|http-equiv="refresh"/i);
  const xml = renderSitemap(origin);
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  assert.equal(locations.length, publicSeoPaths.length);
  assert.equal(new Set(locations).size, locations.length);
  assert.ok(locations.includes("https://www.smpis.digital/"));
  assert.ok(locations.every((location) => new URL(location).origin === origin));
  assert.ok(locations.every((location) => !/[?#]/.test(location)));
  assert.doesNotMatch(
    xml,
    /https:\/\/smpis.digital|\/index.html|\/login|\/signup|\/owner/,
  );
  assert.match(
    renderRobots(origin),
    /Sitemap: https:\/\/www.smpis.digital\/sitemap.xml/,
  );
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
  const homepage = await fetch(`http://127.0.0.1:${server.address().port}/`, {
    redirect: "manual",
  });
  assert.equal(homepage.status, 200);
  assert.equal(homepage.headers.get("location"), null);
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
  for (const route of publicSeoPaths) {
    const page = await fetch(
      `http://127.0.0.1:${server.address().port}${route}`,
      {
        redirect: "manual",
      },
    );
    assert.equal(page.status, 200, `${route} must be served directly`);
    assert.equal(
      page.headers.get("location"),
      null,
      `${route} must not redirect`,
    );
    const content = await page.text();
    assert.ok(
      content.includes(
        `<link rel="canonical" href="https://school.example.com${route}"`,
      ),
    );
    assert.doesNotMatch(content, /noindex|http-equiv="refresh"/i);
  }
});

test("feature guides are crawlable and discoverable without JavaScript", async () => {
  const { productModules, featurePath } =
    await import("../server/product-catalog.js");
  const { publicSeoPaths } = await import("../server/seo.js");
  const { portalSlug } = await import("../server/saas-service.js");
  assert.equal(portalSlug.safeParse("features").success, false);
  assert.equal(portalSlug.safeParse("greenfield-academy").success, true);
  const template = await readFile("index.html", "utf8");
  const directory = renderSeoHtml(
    template,
    "/features",
    "https://school.example.com",
  );
  assert.doesNotMatch(directory, /name="robots" content="noindex/);
  for (const module of productModules) {
    const route = featurePath(module);
    assert.ok(publicSeoPaths.includes(route));
    assert.ok(directory.includes(`href="${route}"`));
    const html = renderSeoHtml(
      template,
      route + "/",
      "https://school.example.com",
    );
    assert.ok(html.includes(`href="https://school.example.com${route}"`));
    assert.match(html, /<h2>What you can do<\/h2>/);
    assert.match(html, /<h2>How it works<\/h2>/);
    assert.match(html, /<h2>Good to know<\/h2>/);
    assert.doesNotMatch(html, /name="robots" content="noindex/);
    assert.equal(
      renderSeoHtml(html, route, "https://school.example.com"),
      html,
    );
  }
  assert.match(
    renderSeoHtml(template, "/features/unknown", "https://school.example.com"),
    /name="robots" content="noindex/,
  );
});
