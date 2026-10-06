import express from "express";
import { z } from "zod";
import { fail } from "./security.js";
import { one, audit } from "./db.js";
export function legalRoutes(db) {
  const router = express.Router();
  router.get("/legal/config", async (req, res) => {
    const settings = await one(
      db,
      "SELECT * FROM site_legal_settings WHERE id=1",
    );
    res.json({
      data: {
        organization:
          settings?.organization || process.env.LEGAL_ORGANIZATION_NAME || "",
        contact:
          settings?.privacy_email || process.env.PRIVACY_CONTACT_EMAIL || "",
        updated: settings?.updated_at
          ? new Date(settings.updated_at).toISOString().slice(0, 10)
          : "2026-10-05",
      },
    });
  });
  return router;
}
export function siteSettingsRoutes(db) {
  const router = express.Router();
  router.patch("/admin/legal", async (req, res) => {
    if (req.user.role !== "SUPER_ADMIN" && !req.user.platform_operator)
      fail(403, "Super administrator access required.", "FORBIDDEN");
    const schools = await one(db, "SELECT count(*)::int AS n FROM schools");
    if (schools.n > 1 && !req.user.platform_operator)
      fail(
        403,
        "Site-wide legal settings require a platform operator.",
        "FORBIDDEN",
      );
    const values = z
      .object({
        organization: z.string().trim().min(2).max(200),
        privacy_email: z.string().trim().email().max(254),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const before = await one(
        tx,
        "SELECT * FROM site_legal_settings WHERE id=1",
      );
      await tx.query(
        "INSERT INTO site_legal_settings(id,organization,privacy_email) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET organization=EXCLUDED.organization,privacy_email=EXCLUDED.privacy_email,updated_at=now()",
        [values.organization, values.privacy_email],
      );
      await audit(
        tx,
        req.user,
        "site_legal_settings",
        1,
        "UPDATE",
        before || null,
        values,
      );
    });
    res.json({ data: values });
  });
  return router;
}
