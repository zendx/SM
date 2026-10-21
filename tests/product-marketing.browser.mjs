// Frontend-only preview: no application database, worker or hosting connection.
import express from "express";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { serveFrontend } from "../server/frontend.js";
import { productModules, featurePath } from "../server/product-catalog.js";
const app = express();
const requests = [];
app.get("/api/v1/saas/plans", (req, res) => {
  requests.push(req.headers["x-smpis-portal"]);
  res.json({
    data: {
      display_currency: "USD",
      monthly_price_cents: 10000,
      trial_days: 30,
    },
  });
});
app.get("/api/v1/legal/config", (req, res) => res.json({ data: {} }));
app.use("/api", (_req, res) =>
  res
    .status(404)
    .json({ errors: [{ message: "Preview endpoint unavailable" }] }),
);
serveFrontend(app, path.resolve("dist"), { origin: "http://127.0.0.1:3000" });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
await mkdir("test-results/product-marketing", { recursive: true });
try {
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "A calmer, smarter way to run your school." })
    .waitFor();
  await page.getByRole("button", { name: "Accept required cookies" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.locator(".catalog-grid article").count(),
    productModules.length,
  );
  await page.getByRole("button", { name: /Yearly/ }).click();
  await page.getByRole("link", { name: "Choose Pro" }).waitFor();
  assert.match(
    await page.getByRole("link", { name: "Choose Pro" }).getAttribute("href"),
    /cycle=YEARLY/,
  );
  for (const img of await page.locator(".product-snapshots img").all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => el.decode());
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/product-marketing/landing-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Features", exact: true })
    .click();
  await page.getByRole("heading", { name: /Know what your school/ }).waitFor();
  await expect(page.locator(".catalog-grid article")).toHaveCount(12);
  const search = page.getByRole("searchbox", {
    name: "Search product features",
  });
  await search.fill("report cards");
  assert.ok((await page.locator(".catalog-grid article").count()) > 0);
  await search.fill("zzzz-no-matching-module");
  await page.getByRole("heading", { name: "No matching features" }).waitFor();
  await page
    .getByRole("button", { name: "Show all features", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Teaching & learning", exact: true })
    .click();
  await expect(page.locator(".catalog-grid article")).toHaveCount(2);
  await page.getByRole("button", { name: "All features", exact: true }).click();
  for (const img of await page.locator(".product-snapshots img").all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => el.decode());
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/product-marketing/directory-desktop.png",
    fullPage: true,
  });
  for (const module of productModules) {
    await page.goto(origin + featurePath(module));
    await page
      .getByRole("heading", { level: 1, name: module.title, exact: true })
      .waitFor();
    await expect(page.locator(".module-capabilities li")).toHaveCount(
      module.capabilities.length,
    );
    assert.equal(await page.locator(".module-workflow ol li").count(), 3);
    assert.equal(await page.locator(".catalog-grid article").count(), 3);
  }
  await page.goto(origin + "/features/exams-report-cards");
  await page
    .getByRole("heading", { level: 1, name: "Exams & report cards" })
    .waitFor();
  await page.screenshot({
    path: "test-results/product-marketing/exams-desktop.png",
    fullPage: true,
  });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      "/",
      "/features",
      "/features/exams-report-cards",
      "/features/finance",
    ]) {
      await page.goto(origin + route);
      await page.locator(".sales-page").waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Horizontal overflow at ${route} ${width}`,
      );
      if (width <= 1000) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await page
          .getByRole("navigation", { name: "Main navigation" })
          .getByRole("link", {
            name: route === "/" ? "Features" : "All features",
            exact: true,
          })
          .waitFor({ state: "visible" });
        await page.getByRole("button", { name: "Close navigation" }).click();
      }
      if (width === 390) {
        for (const img of await page.locator(".product-snapshots img").all()) {
          await img.scrollIntoViewIfNeeded();
          await img.evaluate((el) => el.decode());
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `test-results/product-marketing/${route.replaceAll("/", "-") || "home"}-mobile.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.goto(origin + "/features/not-a-module");
  await page
    .getByRole("heading", { name: "Feature guide not found" })
    .waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(requests.every((value) => value === undefined));
  await writeFile(
    "test-results/product-marketing/result.json",
    JSON.stringify(
      {
        status: "PASS",
        modulePages: 12,
        viewportWidths: [1024, 768, 390, 320],
        pageErrors: errors.length,
        databaseAccess: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: landing, feature search/filter/empty states, 12 module routes, images, pricing, mobile navigation/overflow, no page errors.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
