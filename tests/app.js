import express from "express";
import { createApp as createRealApp } from "../server/app.js";

// Business-workflow fixtures explicitly opt out of enrollment, not production code.
// security-hardening.test.js uses createRealApp and exercises the full policy.
export async function createApp(db, options = {}) {
  if (!db.isTestDatabase)
    throw new Error("Fixtures require an isolated test database.");
  process.env.BOOTSTRAP_TOKEN ||= "fixture-bootstrap-token-only-32-characters";
  process.env.SECURITY_ENCRYPTION_KEY ||= "72".repeat(32);
  const app = express();
  app.use((req, res, next) => {
    if (
      req.method === "POST" &&
      /^\/api\/v1\/auth\/(owner\/)?setup$/.test(req.path)
    )
      req.headers["x-bootstrap-token"] ||= process.env.BOOTSTRAP_TOKEN;
    next();
  });
  app.use(await createRealApp(db, { ...options, enforcePrivilegedMfa: false }));
  return app;
}
