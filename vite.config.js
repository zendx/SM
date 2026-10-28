import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  renderRobots,
  renderSitemap,
  renderSeoHtml,
  siteOrigin,
} from "./server/seo.js";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "smpis-public-seo",
      configureServer(server) {
        server.middlewares.use("/assets/social-image.png", (_req, res) => {
          res.setHeader("Content-Type", "image/png");
          res.end(readFileSync(new URL("./src/assets/favicon.png", import.meta.url)));
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "assets/social-image.png",
          source: readFileSync(new URL("./src/assets/favicon.png", import.meta.url)),
        });
        this.emitFile({
          type: "asset",
          fileName: "email-logo.png",
          source: readFileSync(
            new URL("./server/email-assets/smpis-logo.png", import.meta.url),
          ),
        });
        const origin = siteOrigin({
          ...loadEnv(mode, process.cwd(), ""),
          ...process.env,
        });
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: renderSitemap(origin),
        });
        this.emitFile({
          type: "asset",
          fileName: "robots.txt",
          source: renderRobots(origin),
        });
      },
      transformIndexHtml: {
        order: "pre",
        handler: (html, context) =>
          renderSeoHtml(
            html,
            context.path,
            siteOrigin({ ...loadEnv(mode, process.cwd(), ""), ...process.env }),
          ),
      },
    },
  ],
  build: {
    outDir: process.env.VERCEL ? "public" : "dist",
    emptyOutDir: true,
    copyPublicDir: false,
  },
  server: { host: "127.0.0.1" },
}));
