import express from "express";
import { rateLimit } from "express-rate-limit";
import { PostgresRateLimitStore } from "./rate-limit-store.js";
import { one, rows, insert, audit } from "./db.js";
import { z, text, email, password } from "./validation.js";
import { fail, hashPassword, verifyPassword, token } from "./security.js";
import { requireOwner } from "./platform-access.js";
import { requireRecaptcha } from "./recaptcha.js";
import { screenRegistrationEmail } from "./stopreg.js";
import {
  verificationMailer,
  queueVerification,
  deliverVerifications,
} from "./verification-delivery.js";
import { PRIVACY_POLICY_VERSION } from "./contact-consent.js";

export function threeWorkingDays(value = new Date()) {
  const result = new Date(value);
  let count = 0;
  const weekday = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Lagos",
    weekday: "short",
  });
  while (count < 3) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!["Sat", "Sun"].includes(weekday.format(result))) count++;
  }
  return result;
}
// Called inside the payment settlement transaction, after locking its subscription.
export async function creditReferral(tx, payment) {
  const marketer = await one(
    tx,
    `SELECT m.* FROM school_referrals r JOIN marketers m ON m.user_id=r.marketer_id
    WHERE r.school_id=$1 FOR UPDATE OF m`,
    [payment.school_id],
  );
  if (!marketer || marketer.closed_at || payment.status !== "PAID") return;
  const config = await one(
    tx,
    "SELECT referral_percent FROM saas_settings WHERE id=1",
  );
  if (
    await one(
      tx,
      "SELECT id FROM subscription_payments WHERE school_id=$1 AND status='PAID' AND id<>$2 LIMIT 1",
      [payment.school_id, payment.id],
    )
  )
    return;
  const percent = Number(config.referral_percent);
  const total = BigInt(payment.charge_amount_cents ?? payment.amount_cents);
  const amount = (total * BigInt(Math.round(percent * 100)) + 5000n) / 10000n;
  if (percent <= 0 || amount <= 0n) return;
  await tx.query(
    `INSERT INTO referral_commissions(marketer_id,school_id,payment_id,payment_amount_cents,currency,percent,amount_cents,due_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(payment_id) DO NOTHING`,
    [
      marketer.user_id,
      payment.school_id,
      payment.id,
      total.toString(),
      payment.charge_currency || payment.currency,
      percent,
      amount.toString(),
      threeWorkingDays(payment.paid_at),
    ],
  );
}
export async function attachReferral(tx, schoolId, code, adminEmail) {
  if (!code) return;
  const m = await one(
    tx,
    `SELECT m.user_id,u.email FROM marketers m JOIN users u ON u.id=m.user_id
    WHERE m.code=$1 AND m.closed_at IS NULL AND u.status='ACTIVE' AND u.email_verified FOR UPDATE OF m`,
    [code],
  );
  if (!m)
    fail(422, "Referral code is invalid or the referral account is closed.");
  if (m.email.toLowerCase() === adminEmail.toLowerCase())
    fail(422, "You cannot refer your own school account.");
  await insert(tx, "school_referrals", {
    school_id: schoolId,
    marketer_id: m.user_id,
  });
}
const bankFields = {
  bank_name: text.max(120),
  account_number: z
    .string()
    .trim()
    .regex(/^[0-9]{6,34}$/, "Use 6 to 34 account digits."),
  account_name: text.max(200),
};
export function referralPublicRoutes(db) {
  const r = express.Router();
  r.get("/referrals/program", async (req, res) =>
    res.json({
      data: await one(
        db,
        "SELECT referral_percent FROM saas_settings WHERE id=1",
      ),
    }),
  );
  r.post(
    "/referrals/register",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      store: new PostgresRateLimitStore(db, "marketer-signup"),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    requireRecaptcha("signup"),
    async (req, res) => {
      const b = z
        .object({
          name: text.max(200),
          email,
          password,
          privacy_accepted: z.literal(true),
        })
        .parse(req.body);
      await screenRegistrationEmail(b.email);
      await verificationMailer(db);
      const user = await db.transaction(async (tx) => {
        const u = await insert(tx, "users", {
          school_id: null,
          name: b.name,
          email: b.email,
          password_hash: hashPassword(b.password),
          role: "MARKETER",
          email_verified: false,
          privacy_accepted_at: new Date(),
          privacy_policy_version: PRIVACY_POLICY_VERSION,
        });
        await insert(tx, "marketers", {
          user_id: u.id,
          code: token().slice(0, 16).toUpperCase(),
        });
        await queueVerification(tx, u);
        await audit(tx, u, "users", u.id, "MARKETER_REGISTERED");
        return u;
      });
      await deliverVerifications(db, user.id);
      res
        .status(201)
        .json({
          data: {
            message:
              "Check your email to verify your account, then sign in to the marketer portal.",
          },
        });
    },
  );
  return r;
}
export function referralAccountRoutes(db) {
  const r = express.Router();
  r.use("/referrals/account", (req, res, next) => {
    if (req.user.role !== "MARKETER") fail(403, "Marketer access required.");
    next();
  });
  r.get("/referrals/account", async (req, res) => {
    const account = await one(
      db,
      "SELECT m.*,u.name,u.email FROM marketers m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1",
      [req.user.id],
    );
    const referrals = await rows(
      db,
      `SELECT s.id,s.name,r.created_at,EXISTS(SELECT 1 FROM subscription_payments p WHERE p.school_id=s.id AND p.status='PAID') AS subscribed
      FROM school_referrals r JOIN schools s ON s.id=r.school_id WHERE r.marketer_id=$1 ORDER BY r.created_at DESC`,
      [req.user.id],
    );
    const commissions = await rows(
      db,
      `SELECT c.*,s.name AS school_name,p.reference AS subscription_reference FROM referral_commissions c JOIN schools s ON s.id=c.school_id
      JOIN subscription_payments p ON p.id=c.payment_id WHERE c.marketer_id=$1 ORDER BY c.created_at DESC`,
      [req.user.id],
    );
    res.json({
      data: {
        account,
        referrals,
        commissions,
        program: await one(
          db,
          "SELECT referral_percent FROM saas_settings WHERE id=1",
        ),
      },
    });
  });
  r.patch("/referrals/account", async (req, res) => {
    const b = z
      .object({ name: text.max(200), ...bankFields })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const m = await one(
        tx,
        "SELECT closed_at FROM marketers WHERE user_id=$1 FOR UPDATE",
        [req.user.id],
      );
      if (m.closed_at) fail(403, "This referral account is closed.");
      await tx.query("UPDATE users SET name=$2 WHERE id=$1", [
        req.user.id,
        b.name,
      ]);
      await tx.query(
        "UPDATE marketers SET bank_name=$2,account_number=$3,account_name=$4 WHERE user_id=$1",
        [req.user.id, b.bank_name, b.account_number, b.account_name],
      );
      await audit(
        tx,
        req.user,
        "users",
        req.user.id,
        "MARKETER_PROFILE_UPDATED",
      );
    });
    res.json({ data: { message: "Profile and bank account updated." } });
  });
  r.post("/referrals/account/close", async (req, res) => {
    const b = z.object({ password: z.string().max(128) }).parse(req.body);
    if (!verifyPassword(b.password, req.user.password_hash))
      fail(403, "Password is incorrect.");
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE marketers SET closed_at=COALESCE(closed_at,now()) WHERE user_id=$1",
        [req.user.id],
      );
      await audit(tx, req.user, "users", req.user.id, "MARKETER_CLOSED");
    });
    res.json({
      data: {
        message:
          "Referral account closed. Your history and previously earned commissions are retained. No new referrals or commissions will be accepted.",
      },
    });
  });
  r.patch("/referrals/account/credentials", async (req, res) => {
    const b = z
      .object({
        email,
        current_password: z.string().max(128),
        new_password: password.optional(),
      })
      .strict()
      .parse(req.body);
    const emailChanged = b.email !== req.user.email;
    if (emailChanged) {
      await screenRegistrationEmail(b.email);
      await verificationMailer(db);
    }
    await db.transaction(async (tx) => {
      const m = await one(
        tx,
        "SELECT closed_at FROM marketers WHERE user_id=$1 FOR UPDATE",
        [req.user.id],
      );
      if (m.closed_at) fail(403, "This referral account is closed.");
      const u = await one(tx, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      if (!verifyPassword(b.current_password, u.password_hash))
        fail(403, "Current password is incorrect.");
      await tx.query(
        "UPDATE users SET email=$2,password_hash=$3,email_verified=CASE WHEN email<>$2 THEN false ELSE email_verified END WHERE id=$1",
        [
          u.id,
          b.email,
          b.new_password ? hashPassword(b.new_password) : u.password_hash,
        ],
      );
      if (emailChanged) {
        await tx.query(
          "DELETE FROM email_verification_tokens WHERE user_id=$1",
          [u.id],
        );
        await queueVerification(tx, { ...u, email: b.email });
      }
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await tx.query("DELETE FROM reset_tokens WHERE user_id=$1", [u.id]);
      await audit(
        tx,
        req.user,
        "users",
        u.id,
        "MARKETER_CREDENTIALS_UPDATED",
        null,
        { email_changed: emailChanged, password_changed: !!b.new_password },
      );
    });
    if (emailChanged) await deliverVerifications(db, req.user.id);
    res.json({
      data: {
        message: emailChanged
          ? "Account updated. Verify your new email address before signing in again."
          : "Account updated. Sign in again.",
      },
    });
  });
  return r;
}
export function referralOwnerRoutes(db) {
  const r = express.Router();
  r.use("/saas/owner/referrals", requireOwner);
  r.get("/saas/owner/referrals", async (req, res) =>
    res.json({
      data: {
        program: await one(
          db,
          "SELECT referral_percent FROM saas_settings WHERE id=1",
        ),
        marketers: await rows(
          db,
          `SELECT m.*,u.name,u.email,u.email_verified,(SELECT count(*)::int FROM school_referrals r WHERE r.marketer_id=m.user_id) AS signups
      FROM marketers m JOIN users u ON u.id=m.user_id ORDER BY m.created_at DESC`,
        ),
        commissions: await rows(
          db,
          `SELECT c.*,u.name AS marketer_name,u.email,m.bank_name AS current_bank_name,m.account_number AS current_account_number,m.account_name AS current_account_name,s.name AS school_name
      FROM referral_commissions c JOIN marketers m ON m.user_id=c.marketer_id JOIN users u ON u.id=c.marketer_id JOIN schools s ON s.id=c.school_id ORDER BY c.created_at DESC`,
        ),
      },
    }),
  );
  r.patch("/saas/owner/referrals/settings", async (req, res) => {
    const b = z
      .object({
        referral_percent: z.coerce.number().min(0).max(100).multipleOf(0.01),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE saas_settings SET referral_percent=$1,updated_at=now() WHERE id=1",
        [b.referral_percent],
      );
      await audit(
        tx,
        req.user,
        "saas_settings",
        1,
        "REFERRAL_SETTINGS_UPDATED",
        null,
        b,
      );
    });
    res.json({ data: b });
  });
  r.post("/saas/owner/referrals/:id/paid", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = z
      .object({ payment_reference: text.max(200), ...bankFields })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const c = await one(
        tx,
        "SELECT * FROM referral_commissions WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!c) fail(404, "Commission not found.");
      if (c.status === "PAID")
        fail(409, "This commission is already marked paid.");
      const result = await one(
        tx,
        `UPDATE referral_commissions SET status='PAID',paid_at=now(),paid_by=$2,payment_reference=$3,bank_name=$4,account_number=$5,account_name=$6 WHERE id=$1 RETURNING *`,
        [
          id,
          req.user.id,
          b.payment_reference,
          b.bank_name,
          b.account_number,
          b.account_name,
        ],
      );
      await audit(
        tx,
        req.user,
        "referral_commissions",
        id,
        "COMMISSION_PAID",
        null,
        {
          payment_reference: b.payment_reference,
          amount_cents: c.amount_cents,
          currency: c.currency,
        },
      );
      return result;
    });
    res.json({ data: result });
  });
  return r;
}
