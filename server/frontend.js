import path from "node:path";
import { readFile } from "node:fs/promises";
import { renderSeoHtml, siteOrigin } from "./seo.js";

// Vercel ignores express.static(); explicit file routes also cover requests
// that reach the function instead of the static asset layer.
export function serveFrontend(app, directory, { origin = siteOrigin() } = {}) {
  let template;
  app.get("/assets/{*asset}", (req, res) => {
    const asset = req.params.asset.join("/");
    res.sendFile(
      asset,
      {
        root: path.join(directory, "assets"),
        dotfiles: "deny",
        immutable: true,
        maxAge: "1y",
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
