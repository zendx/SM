import "dotenv/config";
import assert from "node:assert/strict";
import { publicSeoPaths, siteOrigin } from "../server/seo.js";

// Never follow redirects: a successful final response can hide a bad sitemap.
const origin = siteOrigin();
const base = process.argv[2] || origin;
async function get(route, type) {
  const url = new URL(route, base);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200,
    `${url}: HTTP ${response.status}, Location: ${response.headers.get("location")}`);
  assert.equal(response.headers.get("location"), null, `${url}: unexpected Location`);
  assert.ok(response.headers.get("content-type")?.includes(type), `${url}: incorrect content type`);
  return response.text();
}

try {
  const xml = await get("/sitemap.xml", "xml");
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const expected = publicSeoPaths.map(route => new URL(route, origin).href);
  assert.deepEqual([...locations].sort(), [...expected].sort(),
    "Sitemap must contain exactly the canonical public pages, without duplicates or private routes");
  const robots = await get("/robots.txt", "text/plain");
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`), "Incorrect robots sitemap URL");
  for (const route of publicSeoPaths) {
    const canonical = new URL(route, origin).href;
    const html = await get(route, "text/html");
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), `${route}: incorrect canonical`);
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}"`), `${route}: incorrect Open Graph URL`);
    assert.doesNotMatch(html, /http-equiv\s*=\s*["']refresh|name=["']robots["'][^>]*noindex/i, `${route}: redirects or noindex`);
    console.log(`PASS ${canonical} (200, no redirect, matching canonical)`);
  }
  console.log(`SEO audit passed: ${locations.length} public pages, sitemap and robots.txt.`);
} catch (error) {
  console.error(`SEO audit failed: ${error.message}`);
  process.exitCode = 1;
}
