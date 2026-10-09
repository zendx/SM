import { checkAccountAccess } from "./account-lifecycle.js";
import { screenRegistrationEmail } from "./stopreg.js";
import { consoleAccess } from "./platform-access.js";
import { sendVerification, verificationMailer } from "./email-verification.js";
import { smtpConfig } from "./integrations.js";
import express from "express";
import { sendAccountCreatedEmail } from "./account-created-email.js";
import { rateLimit } from "express-rate-limit";
import { PostgresRateLimitStore } from "./rate-limit-store.js";
import * as OTPAuth from "otpauth";
import nodemailer from "nodemailer";
import { renderEmail } from "./email-templates.js";
import { one, rows, insert, audit } from "./db.js";
import { provisionSubscription, schoolAccessAllowed } from "./saas-service.js";
import {
  token,
  digest,
  hashPassword,
  verifyPassword,
  ROLE_PERMISSIONS,
  fail,
  requirePermission,
} from "./security.js";
import {
  z,
  text,
  email,
  password,
  id,
  date,
  studentSchema,
  phoneNumber,
} from "./validation.js";

export async function seedRoles(db) {
  await db.query(
    "INSERT INTO roles(name,permissions) VALUES('PLATFORM_OWNER','[]') ON CONFLICT(name) DO UPDATE SET permissions='[]'",
  );
  for (const [name, permissions] of Object.entries(ROLE_PERMISSIONS))
    await db.query(
      "INSERT INTO roles(name,permissions) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET permissions=EXCLUDED.permissions",
      [name, JSON.stringify(permissions)],
    );
}
export function publicUser(u) {
  return {
    id: u.id,
    school_id: u.school_id,
    portal_slug: u.portal_slug,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: u.permissions,
    mfa_enabled: u.mfa_enabled,
    platform_operator: !!u.platform_operator,
    platform_scope: u.platform_scope || null,
    console_access: consoleAccess(u),
    email_verified: u.email_verified,
    mfa_setup_required: false,
  };
}
function totp(secret, label) {
  return new OTPAuth.TOTP({
    issuer: "SMPIS",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export function authRoutes(
  db,
  { production = process.env.NODE_ENV === "production" } = {},
) {
  const r = express.Router();
  r.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 80,
      store: new PostgresRateLimitStore(db, "auth-ip"),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  r.use(
    [
      "/login",
      "/owner/login",
      "/password-reset/request",
      "/email-verification/resend",
    ],
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      store: new PostgresRateLimitStore(db, "auth-account"),
      keyGenerator: (req) =>
        String(req.body?.email || "")
          .trim()
          .toLowerCase()
          .slice(0, 320),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  r.get("/setup", async (req, res) =>
    res.json({
      data: {
        required:
          !(await one(db, "SELECT id FROM schools LIMIT 1")) &&
          !(await one(db, "SELECT user_id FROM platform_operators LIMIT 1")),
      },
    }),
  );
  r.get("/owner/setup", async (req, res) =>
    res.json({
      data: {
        required: !(await one(
          db,
          "SELECT user_id FROM platform_operators LIMIT 1",
        )),
      },
    }),
  );
  r.post("/owner/setup", async (req, res) => {
    const b = z
      .object({ name: text.max(200), email, password })
      .strict()
      .parse(req.body);
    await screenRegistrationEmail(b.email);
    const mailer = await verificationMailer(db);
    await db.transaction(async (tx) => {
      await tx.query("LOCK TABLE platform_operators IN EXCLUSIVE MODE");
      if (await one(tx, "SELECT user_id FROM platform_operators LIMIT 1"))
        fail(
          409,
          "Owner registration is already complete. Sign in to your owner account.",
        );
      const user = await insert(tx, "users", {
        school_id: null,
        name: b.name,
        email: b.email,
        password_hash: hashPassword(b.password),
        role: "PLATFORM_OWNER",
        email_verified: false,
      });
      await sendVerification(tx, user, mailer);
      await insert(tx, "platform_operators", { user_id: user.id });
      await audit(tx, user, "users", user.id, "OWNER_REGISTERED", null, {
        name: user.name,
        email: user.email,
      });
    });
    res.status(201).json({
      data: {
        message:
          "Owner account created. Check your email to verify your account, then sign in.",
      },
    });
  });
  r.get("/public-admissions/:code", async (req, res) => {
    const school = await one(
      db,
      "SELECT id,name,short_code FROM schools WHERE short_code=$1",
      [req.params.code],
    );
    if (!school) fail(404, "School not found.");
    if (!(await schoolAccessAllowed(db, school.id)))
      fail(
        402,
        "This school portal is inactive. Contact the school administrator.",
      );
    const classes = await rows(
      db,
      "SELECT c.id,c.name FROM classes c JOIN terms t ON t.academic_year_id=c.academic_year_id AND t.school_id=c.school_id AND t.is_current WHERE c.school_id=$1 ORDER BY c.name",
      [school.id],
    );
    res.json({ data: { school, classes } });
  });
  r.post("/public-admissions/:code", async (req, res) => {
    const school = await one(db, "SELECT id FROM schools WHERE short_code=$1", [
      req.params.code,
    ]);
    if (!school) fail(404, "School not found.");
    if (!(await schoolAccessAllowed(db, school.id)))
      fail(
        402,
        "This school portal is inactive. Contact the school administrator.",
      );
    const b = studentSchema.parse(req.body);
    if (
      !(await one(
        db,
        "SELECT c.id FROM classes c JOIN terms t ON t.academic_year_id=c.academic_year_id AND t.school_id=c.school_id AND t.is_current WHERE c.school_id=$1 AND c.id=$2",
        [school.id, b.applied_class_id],
      ))
    )
      fail(422, "Choose a class that is open for applications.");
    const app = await db.transaction(async (tx) => {
      const { applied_class_id, previous_school, ...fields } = b;
      const s = await insert(tx, "students", {
        school_id: school.id,
        ...fields,
      });
      const a = await insert(tx, "admission_applications", {
        school_id: school.id,
        student_id: s.id,
        applied_class_id,
        previous_school,
      });
      await audit(
        tx,
        { id: null, school_id: school.id },
        "admission_applications",
        a.id,
        "PUBLIC_APPLICATION",
        null,
        { student_id: s.id, stage: a.stage },
      );
      return a;
    });
    res.status(201).json({
      data: {
        reference: `APP-${String(app.id).padStart(6, "0")}`,
        message:
          "Application received. Please contact admissions to provide supporting documents and arrange the next step.",
      },
    });
  });
  r.post("/setup", async (req, res) => {
    const b = z
      .object({
        school_name: text,
        phone_number: phoneNumber,
        short_code: text.max(12).regex(/^[A-Z0-9]+$/),
        currency_code: z.string().regex(/^[A-Z]{3}$/),
        timezone: text,
        name: text,
        email,
        password,
        year_name: text,
        start_date: date,
        end_date: date,
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone });
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: b.currency_code,
      });
    } catch {
      fail(422, "Invalid timezone or currency.");
    }
    if (b.end_date <= b.start_date)
      fail(422, "The academic year end must follow its start.");
    await screenRegistrationEmail(b.email);
    const mailer = await verificationMailer(db);
    await db.transaction(async (tx) => {
      await tx.query("LOCK TABLE platform_operators IN EXCLUSIVE MODE");
      await tx.query("LOCK TABLE schools IN EXCLUSIVE MODE");
      if (await one(tx, "SELECT id FROM schools LIMIT 1"))
        fail(409, "Setup has already been completed.");
      if (await one(tx, "SELECT user_id FROM platform_operators LIMIT 1"))
        fail(
          409,
          "Owner setup is complete. Register schools through the public signup or owner dashboard.",
        );
      const school = await insert(tx, "schools", {
        name: b.school_name,
        short_code: b.short_code,
        currency_code: b.currency_code,
        timezone: b.timezone,
        portal_slug: `school-${b.short_code.toLowerCase()}`,
      });
      const user = await insert(tx, "users", {
        school_id: school.id,
        name: b.name,
        email: b.email,
        password_hash: hashPassword(b.password),
        role: "SUPER_ADMIN",
        phone_number: b.phone_number,
        email_verified: false,
      });
      const year = await insert(tx, "academic_years", {
        school_id: school.id,
        name: b.year_name,
        start_date: b.start_date,
        end_date: b.end_date,
      });
      await sendVerification(tx, user, mailer);
      await insert(tx, "platform_operators", { user_id: user.id });
      await provisionSubscription(tx, school, {}, user.id);
      const termEnd = new Date(b.start_date);
      termEnd.setUTCDate(termEnd.getUTCDate() + 100);
      await insert(tx, "terms", {
        school_id: school.id,
        academic_year_id: year.id,
        name: "Term 1",
        start_date: b.start_date,
        end_date:
          termEnd.toISOString().slice(0, 10) < b.end_date
            ? termEnd.toISOString().slice(0, 10)
            : b.end_date,
        is_current: true,
      });
      await audit(tx, user, "schools", school.id, "CREATE", null, {
        name: school.name,
      });
    });
    res.status(201).json({
      data: {
        message:
          "School created. Check your email to verify your account, then sign in.",
      },
    });
  });
  r.post(["/login", "/owner/login"], async (req, res) => {
    const b = z
      .object({ email, password: z.string().max(128) })
      .parse(req.body);
    const u = await one(
      db,
      "SELECT u.*,c.portal_slug,r.permissions,EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id) AS platform_operator,(SELECT ps.scope FROM platform_staff ps WHERE ps.user_id=u.id) AS platform_scope FROM users u JOIN roles r ON r.name=u.role LEFT JOIN schools c ON c.id=u.school_id WHERE email=$1",
      [b.email],
    );
    if (
      !u ||
      !verifyPassword(b.password, u.password_hash) ||
      u.status !== "ACTIVE"
    )
      fail(401, "Email or password is incorrect.", "UNAUTHENTICATED");
    if (req.path === "/owner/login" && !consoleAccess(u))
      fail(
        403,
        "This account is not an SMPIS owner account. Use your school portal.",
        "OWNER_REQUIRED",
      );
    await checkAccountAccess(db, u);
    if (!u.email_verified)
      fail(
        403,
        "Verify your email before signing in. Use the resend verification option if needed.",
        "EMAIL_VERIFICATION_REQUIRED",
      );
    if (!u.platform_operator && req.get("x-smpis-portal")) {
      const school = await one(
        db,
        "SELECT portal_slug FROM schools WHERE id=$1",
        [u.school_id],
      );
      if (school?.portal_slug !== req.get("x-smpis-portal"))
        fail(
          403,
          "This account belongs to a different school portal.",
          "TENANT_MISMATCH",
        );
    }
    const raw = token(),
      csrf = token();
    await insert(db, "sessions", {
      token_hash: digest(raw),
      user_id: u.id,
      csrf,
      mfa_verified: !u.mfa_enabled,
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });
    res.cookie("smpis_session", raw, {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      maxAge: 8 * 60 * 60 * 1000,
      path: "/",
    });
    await audit(db, u, "users", u.id, "LOGIN");
    res.json({
      data: { user: publicUser(u), csrf, mfa_required: u.mfa_enabled },
    });
  });
  r.post("/email-verification/confirm", async (req, res) => {
    const b = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const link = await one(
        tx,
        "DELETE FROM email_verification_tokens WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
        [digest(b.token)],
      );
      if (!link)
        fail(
          422,
          "This verification link is invalid or expired. Request a new link.",
        );
      await tx.query("UPDATE users SET email_verified=true WHERE id=$1", [
        link.user_id,
      ]);
      await tx.query("DELETE FROM email_verification_tokens WHERE user_id=$1", [
        link.user_id,
      ]);
    });
    res.json({ data: { message: "Email verified. You can now sign in." } });
  });
  r.post("/email-verification/resend", async (req, res) => {
    const b = z.object({ email }).parse(req.body);
    const u = await one(
      db,
      "SELECT * FROM users WHERE email=$1 AND NOT email_verified AND status='ACTIVE'",
      [b.email],
    );
    if (u) {
      try {
        await sendVerification(db, u);
      } catch {
        console.error(
          "Email verification delivery failed; check platform SMTP configuration.",
        );
      }
    }
    res.json({
      data: {
        message: "If this account needs verification, a link has been sent.",
      },
    });
  });
  r.post("/password-reset/request", async (req, res) => {
    const b = z.object({ email }).parse(req.body);
    if (!process.env.APP_URL)
      fail(
        503,
        "Password reset email is not configured. Contact your school administrator.",
      );
    const u = await one(
      db,
      "SELECT * FROM users WHERE email=$1 AND status=$2",
      [b.email, "ACTIVE"],
    );
    try {
      if (u) {
        const smtp = await smtpConfig(db, u.school_id);
        if (smtp) {
          const raw = token();
          await db.query("DELETE FROM reset_tokens WHERE user_id=$1", [u.id]);
          await insert(db, "reset_tokens", {
            token_hash: digest(raw),
            user_id: u.id,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
          });
          await nodemailer.createTransport(smtp.transport).sendMail({
            from: smtp.from,
            to: u.email,
            ...(await renderEmail(db, "password_reset", {
              name: u.name,
              link: `${process.env.APP_URL}/?reset=${raw}`,
            })),
          });
        }
      }
    } catch {
      console.error(
        "Password reset delivery failed; check the school email configuration.",
      );
    }
    res.json({
      data: { message: "If this account exists, a reset link has been sent." },
    });
  });
  r.post("/password-reset/confirm", async (req, res) => {
    const b = z.object({ token: text, password }).parse(req.body);
    await db.transaction(async (tx) => {
      const reset = await one(
        tx,
        "DELETE FROM reset_tokens WHERE token_hash=$1 AND expires_at>now() RETURNING *",
        [digest(b.token)],
      );
      if (!reset) fail(422, "This reset link is invalid or expired.");
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hashPassword(b.password),
        reset.user_id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [reset.user_id]);
    });
    res.json({ data: { message: "Password updated. Sign in again." } });
  });
  return r;
}
export function authenticate(db) {
  return async (req, res, next) => {
    const raw = req.cookies.smpis_session;
    if (!raw) fail(401, "Sign in to continue.", "UNAUTHENTICATED");
    const u = await one(
      db,
      "SELECT u.*,c.portal_slug,r.permissions,s.csrf,s.mfa_verified,EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id) AS platform_operator,(SELECT ps.scope FROM platform_staff ps WHERE ps.user_id=u.id) AS platform_scope FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN schools c ON c.id=u.school_id JOIN roles r ON r.name=u.role WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status=$2",
      [digest(raw), "ACTIVE"],
    );
    if (!u)
      fail(401, "Your session expired. Sign in again.", "UNAUTHENTICATED");
    await checkAccountAccess(db, u);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("x-csrf-token") !== u.csrf
    )
      fail(403, "Invalid request token. Reload the page.", "FORBIDDEN");
    if (
      !u.mfa_verified &&
      !["/auth/mfa/verify", "/auth/logout", "/me"].includes(req.path)
    )
      fail(403, "Complete two-step verification.", "MFA_REQUIRED");
    const slug = req.get("x-smpis-portal");
    if (
      u.platform_operator &&
      slug &&
      !req.path.startsWith("/auth/") &&
      !req.path.startsWith("/saas/owner")
    ) {
      const school = await one(
        db,
        "SELECT id,portal_slug FROM schools WHERE portal_slug=$1",
        [slug],
      );
      if (!school) fail(404, "School portal not found.");
      u.school_id = school.id;
      u.portal_slug = school.portal_slug;
      u.role = "SUPER_ADMIN";
      u.permissions = ROLE_PERMISSIONS.SUPER_ADMIN;
    }
    req.user = u;
    req.sessionHash = digest(raw);
    next();
  };
}
export function accountRoutes(db) {
  const r = express.Router();
  r.use(
    "/auth/mfa",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      store: new PostgresRateLimitStore(db, "mfa-ip"),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  r.use(
    "/auth/mfa",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      store: new PostgresRateLimitStore(db, "mfa-account"),
      keyGenerator: (req) => String(req.user.id),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  r.get("/me", (req, res) =>
    res.json({
      data: {
        user: publicUser(req.user),
        csrf: req.user.csrf,
        mfa_required: !req.user.mfa_verified,
      },
    }),
  );
  r.post("/auth/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      req.sessionHash,
    ]);
    res.clearCookie("smpis_session", { path: "/" });
    res.json({ data: { ok: true } });
  });
  r.post("/auth/mfa/verify", async (req, res) => {
    const code = z.string().trim().max(64).parse(req.body.code);
    if (/^[a-f0-9]{24}$/.test(code)) {
      await db.transaction(async (tx) => {
        const used = await one(
          tx,
          "DELETE FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 RETURNING user_id",
          [req.user.id, digest(code)],
        );
        if (!used) fail(422, "Invalid or already used recovery code.");
        await tx.query(
          "UPDATE sessions SET mfa_verified=true WHERE token_hash=$1",
          [req.sessionHash],
        );
        await audit(tx, req.user, "users", req.user.id, "MFA_RECOVERY_USED");
      });
      return res.json({ data: { ok: true } });
    }
    if (
      !req.user.mfa_secret ||
      totp(req.user.mfa_secret, req.user.email).validate({
        token: code,
        window: 1,
      }) === null
    )
      fail(422, "Invalid verification code.");
    await db.query(
      "UPDATE sessions SET mfa_verified=true WHERE token_hash=$1",
      [req.sessionHash],
    );
    res.json({ data: { ok: true } });
  });
  r.post("/auth/mfa/setup", async (req, res) => {
    if (req.user.mfa_enabled)
      fail(409, "Two-step verification is already enabled.");
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    await db.query("UPDATE users SET mfa_secret=$1 WHERE id=$2", [
      secret,
      req.user.id,
    ]);
    res.json({
      data: { secret, uri: totp(secret, req.user.email).toString() },
    });
  });
  r.post("/auth/mfa/recovery-codes", async (req, res) => {
    if (
      !req.user.mfa_enabled ||
      !verifyPassword(String(req.body.password || ""), req.user.password_hash)
    )
      fail(422, "Enable MFA and confirm your current password.");
    const codes = Array.from({ length: 10 }, () => token().slice(0, 24));
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [
        req.user.id,
      ]);
      for (const code of codes)
        await insert(tx, "mfa_recovery_codes", {
          user_id: req.user.id,
          code_hash: digest(code),
        });
      await audit(tx, req.user, "users", req.user.id, "MFA_RECOVERY_GENERATED");
    });
    res.json({ data: { codes } });
  });
  r.post("/auth/mfa/enable", async (req, res) => {
    if (
      !req.user.mfa_secret ||
      totp(req.user.mfa_secret, req.user.email).validate({
        token: String(req.body.code),
        window: 1,
      }) === null
    )
      fail(422, "Invalid verification code.");
    await db.query("UPDATE users SET mfa_enabled=true WHERE id=$1", [
      req.user.id,
    ]);
    await db.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
      req.user.id,
      req.sessionHash,
    ]);
    res.json({ data: { ok: true } });
  });
  r.get("/users", requirePermission("admin.write"), async (req, res) =>
    res.json({
      data: await rows(
        db,
        "SELECT id,name,email,role,status,mfa_enabled FROM users WHERE school_id=$1 ORDER BY name",
        [req.user.school_id],
      ),
    }),
  );
  r.post("/users", requirePermission("admin.write"), async (req, res) => {
    const b = z
      .object({
        name: text,
        email,
        password,
        role: z.enum(Object.keys(ROLE_PERMISSIONS)),
      })
      .parse(req.body);
    const u = await db.transaction(async (tx) => {
      const user = await insert(tx, "users", {
        school_id: req.user.school_id,
        name: b.name,
        email: b.email,
        password_hash: hashPassword(b.password),
        role: b.role,
      });
      await audit(tx, req.user, "users", user.id, "CREATE", null, {
        name: user.name,
        email: user.email,
        role: user.role,
      });
      return user;
    });
    const accountEmailSent = await sendAccountCreatedEmail(db, u, b.password);
    res.status(201).json({
      data: {
        ...publicUser(u),
        account_email_sent: accountEmailSent,
        message: accountEmailSent
          ? "Account created. Sign-in details and security guidance were emailed to the user."
          : "Account created, but the account email could not be sent. Check the SMTP settings; the user has not received their sign-in details.",
      },
    });
  });
  r.patch("/users/:id", requirePermission("admin.write"), async (req, res) => {
    const uid = id.parse(req.params.id),
      b = z
        .object({
          role: z.enum(Object.keys(ROLE_PERMISSIONS)),
          status: z.enum(["ACTIVE", "SUSPENDED"]),
        })
        .parse(req.body);
    if (uid === req.user.id)
      fail(422, "You cannot change your own role or status.");
    await db.transaction(async (tx) => {
      const u = await one(
        tx,
        "SELECT id,role,status FROM users WHERE school_id=$1 AND id=$2",
        [req.user.school_id, uid],
      );
      if (!u) fail(404, "User not found.");
      await tx.query("UPDATE users SET role=$1,status=$2 WHERE id=$3", [
        b.role,
        b.status,
        uid,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(tx, req.user, "users", uid, "UPDATE", u, b);
    });
    res.json({ data: { ok: true } });
  });
  return r;
}
