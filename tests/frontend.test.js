import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { serveFrontend } from "../server/frontend.js";

test("frontend file routes serve JS/CSS bytes, reject missing assets and retain SPA navigation", async () => {
  const directory = path.resolve("test-results/frontend-routing");
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await writeFile(path.join(directory, "index.html"), "<!doctype html><div id='root'>SPA</div>");
  await writeFile(path.join(directory, "assets", "app-test.js"), "console.log('frontend');");
  await writeFile(path.join(directory, "assets", "app-test.css"), "body { color: green; }");
  const app = express();
  app.get("/api/test", (req, res) => res.json({ ok: true }));
  serveFrontend(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const js = await fetch(`${base}/assets/app-test.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /javascript/);
    assert.equal(await js.text(), "console.log('frontend');");
    assert.match(js.headers.get("cache-control"), /immutable/);
    const css = await fetch(`${base}/assets/app-test.css`);
    assert.match(css.headers.get("content-type"), /text\/css/);
    assert.equal(await css.text(), "body { color: green; }");
    const missing = await fetch(`${base}/assets/missing.js`);
    assert.equal(missing.status, 404);
    assert.ok(!(await missing.text()).includes("<!doctype"));
    const page = await fetch(`${base}/school/dashboard`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /SPA/);
    assert.deepEqual(await (await fetch(`${base}/api/test`)).json(), { ok: true });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
