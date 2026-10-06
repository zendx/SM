import { siteSettingsRoutes, legalRoutes } from "./site-routes.js";
import { integrationRoutes } from "./integrations.js";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { authRoutes, authenticate, accountRoutes, seedRoles } from "./auth.js";
import { coreRoutes } from "./routes.js";
import { reportingRoutes } from "./reporting.js";
import { academicRoutes } from "./academic-routes.js";
import { operationsRoutes } from "./operations-routes.js";
import { paymentRoutes, paystackWebhook } from "./paystack.js";
import { intelligenceRoutes } from "./intelligence.js";
import { refinementRoutes } from "./refinement-routes.js";
import { modelRoutes } from "./model-routes.js";
import {
  createDocumentStorage,
  createMemoryDocumentStorage,
} from "./document-storage.js";
import { runJobs } from "./jobs.js";
import { DOCUMENT_MAX_MB } from "./document-limits.js";

export async function createApp(db, options = {}) {
  await seedRoles(db);
  options = {
    ...options,
    production: Boolean(
      options.production ||
      process.env.NODE_ENV === "production" ||
      process.env.VERCEL,
    ),
    documentStorage:
      options.documentStorage ||
      (db.isTestDatabase
        ? createMemoryDocumentStorage()
        : createDocumentStorage()),
  };
  const app = express();
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (Number.isInteger(proxyHops) && proxyHops > 0 && proxyHops <= 3)
    app.set("trust proxy", proxyHops);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: options.production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
      strictTransportSecurity: options.production ? undefined : false,
    }),
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buf) => {
        if (req.originalUrl.startsWith("/api/v1/webhooks/paystack/"))
          req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.post("/api/v1/webhooks/paystack/:school", paystackWebhook(db));
  app.get("/healthz", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin")) {
      const origin = new URL(req.get("origin"));
      if (origin.host !== req.get("host"))
        return res.status(403).json({
          errors: [
            {
              code: "FORBIDDEN",
              message: "Cross-origin requests are not allowed.",
            },
          ],
        });
    }
    next();
  });
  app.get("/api/cron", async (req, res, next) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get("authorization") !== `Bearer ${secret}`)
      return res.status(401).json({ error: "Unauthorized" });
    try {
      await runJobs(db);
      res.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });
  app.use("/api/v1", legalRoutes(db));
  app.use("/api/v1/auth", authRoutes(db, options));
  app.use(
    "/api/v1",
    authenticate(db),
    accountRoutes(db),
    coreRoutes(db, options),
    integrationRoutes(db),
    siteSettingsRoutes(db),
    academicRoutes(db),
    operationsRoutes(db),
    refinementRoutes(db, options),
    paymentRoutes(db, options),
    intelligenceRoutes(db),
    modelRoutes(db),
    reportingRoutes(db),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({
      errors: [{ code: "NOT_FOUND", message: "API endpoint not found." }],
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError)
      return res.status(422).json({
        errors: err.issues.map((i) => ({
          code: "VALIDATION_ERROR",
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (err.code === "23505")
      return res.status(409).json({
        errors: [
          {
            code: "CONFLICT",
            message: "This record already exists. Refresh and try again.",
          },
        ],
      });
    if (["23503", "23514"].includes(err.code))
      return res.status(422).json({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "A linked record or value is invalid.",
          },
        ],
      });
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(422).json({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: `Document size must not exceed ${DOCUMENT_MAX_MB} MB.`,
          },
        ],
      });
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({
      errors: [
        {
          code: err.code || "SERVER_ERROR",
          message: err.status
            ? err.message
            : "An unexpected error occurred. Please try again.",
        },
      ],
    });
  });
  return app;
}
