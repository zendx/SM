import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderRobots, renderSitemap, renderSeoHtml, siteOrigin } from "./seo.js";

// Vercel ignores express.static(); explicit file routes also cover requests
// that reach the function instead of the static asset layer.
export function serveFrontend(app, directory, { origin = siteOrigin() } = {}) {
  let template;
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send(renderRobots(origin));
  });
  app.get("/sitemap.xml", (req, res) => {
    res.type("application/xml").send(renderSitemap(origin));
  });
  app.get("/assets/{*asset}", (req, res) => {
    const asset = req.params.asset.join("/");
    res.sendFile(
      asset,
      {
        root: path.join(directory, "assets"),
        dotfiles: "deny",
        immutable: asset !== "social-image.png",
        maxAge: asset === "social-image.png" ? "1d" : "1y",
        // The public logo is also embedded in externally hosted HTML emails.
        ...(/^smpis-logo-[\w-]+\.png$/.test(asset)
          ? { headers: { "Cross-Origin-Resource-Policy": "cross-origin" } }
          : {}),
      },
      (error) => {
        if (!error || res.headersSent) return;
        res
          .status(error.status === 403 ? 403 : 404)
          .type("text/plain")
          .send("Asset not found.");
      },
    );
  });
  app.get("/assets", (req, res) => res.sendStatus(404));
  app.get("/{*route}", async (req, res) => {
    res.set("Cache-Control", "no-cache");
    template ||= readFile(path.join(directory, "index.html"), "utf8");
    res.type("html").send(renderSeoHtml(await template, req.path, origin));
  });
}
