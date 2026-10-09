import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "./validation.js";
import { one, audit } from "./db.js";
import { fail } from "./security.js";

export const PRIVACY_POLICY_VERSION = "2026-10-09";
const preferences = z
  .object({
    marketing_email_consent: z.boolean(),
    marketing_phone_consent: z.boolean(),
  })
  .strict();
const select =
  "SELECT id,school_id,email,marketing_email_consent,marketing_phone_consent,contact_preferences_updated_at FROM users WHERE id=$1";
const publicPreferences = (user) => ({
  marketing_email_consent: user.marketing_email_consent,
  marketing_phone_consent: user.marketing_phone_consent,
  updated_at: user.contact_preferences_updated_at,
});

function signature(user) {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(key || ""))
    fail(
      503,
      "Newsletter unsubscribe links are not configured. Contact SMPIS support.",
    );
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`promotional-email:${user.id}:${user.email}`)
    .digest("hex");
}

export function newsletterUnsubscribeLink(user) {
  if (!process.env.APP_URL) fail(503, "Newsletter links are not configured.");
  const url = new URL("/login", process.env.APP_URL);
  url.searchParams.set("unsubscribe", `${user.id}.${signature(user)}`);
  return url.href;
}

async function savePreferences(tx, user, values, action) {
  const updated = await one(
    tx,
    `UPDATE users SET marketing_email_consent=$2,
    marketing_phone_consent=$3,contact_preferences_updated_at=now() WHERE id=$1 RETURNING *`,
    [user.id, values.marketing_email_consent, values.marketing_phone_consent],
  );
  await audit(
    tx,
    user,
    "users",
    user.id,
    action,
    publicPreferences(user),
    publicPreferences(updated),
  );
  if (!updated.marketing_email_consent)
    await tx.query(
      "UPDATE platform_notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND template_key='promotional_newsletter' AND email_status='PENDING'",
      [user.id],
    );
  return publicPreferences(updated);
}

export function publicConsentRoutes(db) {
  const router = express.Router();
  // Opening an email link never changes consent: the recipient confirms by POST.
  router.post("/communications/unsubscribe", async (req, res) => {
    const { token } = z
      .object({ token: z.string().regex(/^[1-9]\d*\.[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const [id, hash] = token.split(".");
    z.coerce.number().int().positive().max(2147483647).parse(id);
    const result = await db.transaction(async (tx) => {
      const user = await one(tx, select + " FOR UPDATE", [id]);
      if (
        !user ||
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          Buffer.from(signature(user), "hex"),
        )
      )
        fail(
          422,
          "This unsubscribe link is invalid. Update your preferences in your SMPIS inbox or contact support.",
        );
      return savePreferences(
        tx,
        user,
        { ...publicPreferences(user), marketing_email_consent: false },
        "NEWSLETTER_UNSUBSCRIBED",
      );
    });
    res.json({
      data: {
        ...result,
        message:
          "You are unsubscribed from promotional email newsletters. Account, security and service emails will continue.",
      },
    });
  });
  return router;
}

export function contactPreferenceRoutes(db) {
  const router = express.Router();
  router.get("/subscription/contact-preferences", async (req, res) => {
    res.json({ data: publicPreferences(await one(db, select, [req.user.id])) });
  });
  router.patch("/subscription/contact-preferences", async (req, res) => {
    const values = preferences.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const user = await one(tx, select + " FOR UPDATE", [req.user.id]);
      if (
        values.marketing_phone_consent &&
        !(
          await one(tx, "SELECT phone_number FROM users WHERE id=$1", [user.id])
        ).phone_number
      )
        fail(
          422,
          "Add a phone number to your account before choosing promotional phone messages.",
        );
      return savePreferences(tx, user, values, "CONTACT_PREFERENCES_UPDATED");
    });
    res.json({
      data: { ...result, message: "Communication preferences saved." },
    });
  });
  return router;
}
