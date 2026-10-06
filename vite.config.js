import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { renderSeoHtml, siteOrigin } from "./server/seo.js";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "smpis-public-seo",
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
