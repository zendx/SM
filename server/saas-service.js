import { sendVerification, verificationMailer } from "./email-verification.js";
import { screenRegistrationEmail } from "./stopreg.js";
import { one, rows, insert } from "./db.js";
import { fail, hashPassword, token } from "./security.js";
import { z, email, password, text, date, phoneNumber } from "./validation.js";
import { providerSummaries } from "./saas-providers.js";

const reserved = new Set([
  "api",
  "assets",
  "terms",
  "privacy",
  "cookies",
  "owner",
  "signup",
  "login",
  "healthz",
  "src",
  "public",
  "admin",
]);
export const portalSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens; start with a letter.",
  )
  .refine((value) => !reserved.has(value), "This portal name is reserved.");
export const registrationSchema = z.object({
  school_name: text.max(200),
  portal_slug: portalSlug,
  name: text.max(200),
  email,
  phone_number: phoneNumber,
  password,
  plan: z.enum(["FREE", "PRO"]),
  billing_cycle: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  currency_code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("NGN"),
  timezone: text.default("Africa/Lagos"),
  year_name: text.max(80),
  start_date: date,
  end_date: date,
});
export const price = (cycle, config = {}) =>
  cycle === "YEARLY"
    ? Number(config.yearly_price_cents ?? 102000)
    : Number(config.monthly_price_cents ?? 10000);
export const portalPath = (slug) => `/${slug}/`;
export function nextPeriod(start, cycle) {
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (cycle === "YEARLY" ? 12 : 1));
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
export async function subscriptionEvent(
  db,
  schoolId,
  actorId,
  action,
  details = {},
) {
  return insert(db, "subscription_events", {
    school_id: schoolId,
    actor_id: actorId || null,
    action,
    details: JSON.stringify(details),
  });
}
export async function provisionSubscription(
  db,
  school,
  { plan = "FREE", billing_cycle = "MONTHLY" } = {},
  actorId = null,
) {
  const sub = await one(
    db,
    `UPDATE school_subscriptions SET plan=$2,billing_cycle=$3,status=$4,
    period_end=CASE WHEN $2='PRO' THEN now() ELSE trial_ends_at END WHERE school_id=$1 RETURNING *`,
    [
      school.id,
      plan,
      billing_cycle,
      plan === "FREE" ? "TRIAL" : "PENDING_PAYMENT",
    ],
  );
  await subscriptionEvent(db, school.id, actorId, "CREATED", {
    plan,
    billing_cycle,
    portal_slug: school.portal_slug,
  });
  return sub;
}
export async function registerSchool(db, values, owner = null) {
  const b = registrationSchema.parse(values);
  if (b.end_date <= b.start_date)
    fail(422, "Academic year end must follow its start.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: b.timezone });
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: b.currency_code,
    });
  } catch {
    fail(422, "Enter a valid timezone and school currency.");
  }
  await screenRegistrationEmail(b.email);
  const mailer = await verificationMailer(db);
  return db.transaction(async (tx) => {
    // Public signup cannot win the owner bootstrap race.
    await tx.query("LOCK TABLE schools IN EXCLUSIVE MODE");
    if (
      !owner &&
      !(await one(tx, "SELECT user_id FROM platform_operators LIMIT 1"))
    )
      fail(
        503,
        "School registration will open after the SMPIS owner completes setup.",
      );
    const school = await insert(tx, "schools", {
      name: b.school_name,
      portal_slug: b.portal_slug,
      short_code: `S${token().slice(0, 10).toUpperCase()}`,
      currency_code: b.currency_code,
      timezone: b.timezone,
    });
    const admin = await insert(tx, "users", {
      school_id: school.id,
      name: b.name,
      email: b.email,
      phone_number: b.phone_number,
      password_hash: hashPassword(b.password),
      role: "SUPER_ADMIN",
      email_verified: false,
    });
    const year = await insert(tx, "academic_years", {
      school_id: school.id,
      name: b.year_name,
      start_date: b.start_date,
      end_date: b.end_date,
    });
    await insert(tx, "terms", {
      school_id: school.id,
      academic_year_id: year.id,
      name: "Term 1",
      start_date: b.start_date,
      end_date: b.end_date,
      is_current: true,
    });
    const subscription = await provisionSubscription(
      tx,
      school,
      b,
      owner?.id || admin.id,
    );
    await sendVerification(tx, admin, mailer);
    return {
      verification_required: true,
      message: "Check your email to verify your account before signing in.",
      school: {
        id: school.id,
        name: school.name,
        portal_slug: school.portal_slug,
      },
      subscription,
      portal_url: portalPath(school.portal_slug),
    };
  });
}
export async function settings(db) {
  return one(db, "SELECT * FROM saas_settings WHERE id=1");
}
export function accessAllowed(sub, graceDays = 0, now = new Date()) {
  if (!sub) return false;
  if (!["TRIAL", "ACTIVE"].includes(sub.status)) return false;
  const end = new Date(sub.period_end).getTime();
  const grace =
    sub.status === "ACTIVE" && sub.plan === "PRO" ? graceDays * 86400000 : 0;
  return Number.isFinite(end) && now.getTime() < end + grace;
}
export async function expireSubscriptions(db, schoolId = null) {
  // Transition and event are atomic even when the cron and a request overlap.
  return db.transaction(async (tx) => {
    const changed = await rows(
      tx,
      `UPDATE school_subscriptions s SET status='SUSPENDED',
      suspension_reason=CASE WHEN s.status='TRIAL' THEN 'TRIAL_EXPIRED' ELSE 'OVERDUE' END,updated_at=now()
      FROM saas_settings c WHERE c.id=1 AND s.status IN ('TRIAL','ACTIVE')
      AND ($1::int IS NULL OR s.school_id=$1)
      AND NOT EXISTS(SELECT 1 FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=s.school_id)
      AND s.period_end + CASE WHEN s.status='ACTIVE' AND s.plan='PRO' THEN c.grace_days*interval '1 day' ELSE interval '0 days' END <= now()
      RETURNING s.*`,
      [schoolId],
    );
    for (const sub of changed)
      await subscriptionEvent(tx, sub.school_id, null, "AUTO_SUSPENDED", {
        reason: sub.suspension_reason,
      });
    return changed;
  });
}
export async function subscriptionSnapshot(db, schoolId) {
  await expireSubscriptions(db, schoolId);
  const sub = await one(
    db,
    "SELECT s.*,c.portal_slug,c.name AS school_name FROM school_subscriptions s JOIN schools c ON c.id=s.school_id WHERE s.school_id=$1",
    [schoolId],
  );
  const config = await settings(db);
  const ownerWorkspace = !!(await one(
    db,
    "SELECT o.user_id FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=$1",
    [schoolId],
  ));
  return {
    ...sub,
    owner_workspace: ownerWorkspace,
    access_allowed: ownerWorkspace || accessAllowed(sub, config.grace_days),
    settings: config,
    providers: await providerSummaries(db),
    payments: await rows(
      db,
      "SELECT * FROM subscription_payments WHERE school_id=$1 ORDER BY created_at DESC LIMIT 100",
      [schoolId],
    ),
  };
}
export function subscriptionGate(db) {
  // Public admissions and authenticated operations share the same expiry rules.
  return async (req, res, next) => {
    if (
      req.user.school_id === null &&
      !["/me", "/admin/legal"].includes(req.path) &&
      !req.path.startsWith("/auth/") &&
      !req.path.startsWith("/saas/owner") &&
      !req.path.startsWith("/subscription/notices")
    )
      fail(
        403,
        "The owner account manages the SMPIS business. School records are available through school accounts.",
        "OWNER_SCOPE",
      );
    if (req.user.platform_scope && !req.user.platform_operator) {
      if (req.get("x-smpis-portal"))
        fail(
          403,
          "Delegated console accounts cannot access school portals.",
          "OWNER_SCOPE",
        );
      if (
        req.path === "/me" ||
        req.path.startsWith("/auth/") ||
        req.path.startsWith("/saas/owner") ||
        req.path.startsWith("/subscription/notices")
      )
        return next();
      fail(
        403,
        "Delegated console accounts cannot access school records.",
        "OWNER_SCOPE",
      );
    }
    const slug = req.get("x-smpis-portal");
    if (slug) {
      const school = await one(
        db,
        "SELECT portal_slug FROM schools WHERE id=$1",
        [req.user.school_id],
      );
      if (school?.portal_slug !== slug)
        fail(
          403,
          "This account belongs to a different school portal.",
          "TENANT_MISMATCH",
        );
    }
    if (req.user.platform_operator) return next();
    if (
      await one(
        db,
        "SELECT o.user_id FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=$1",
        [req.user.school_id],
      )
    )
      return next();
    if (
      req.path === "/me" ||
      req.path.startsWith("/auth/") ||
      req.path.startsWith("/subscription") ||
      (req.path === "/config" && req.method === "GET")
    )
      return next();
    await expireSubscriptions(db, req.user.school_id);
    const sub = await one(
      db,
      "SELECT * FROM school_subscriptions WHERE school_id=$1",
      [req.user.school_id],
    );
    if (!accessAllowed(sub, (await settings(db)).grace_days))
      fail(
        402,
        "Your school subscription is inactive. Contact your school administrator to renew.",
        "SUBSCRIPTION_INACTIVE",
      );
    next();
  };
}
export async function schoolAccessAllowed(db, schoolId) {
  if (
    await one(
      db,
      "SELECT o.user_id FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=$1",
      [schoolId],
    )
  )
    return true;
  await expireSubscriptions(db, schoolId);
  return accessAllowed(
    await one(db, "SELECT * FROM school_subscriptions WHERE school_id=$1", [
      schoolId,
    ]),
    (await settings(db)).grace_days,
  );
}
export async function settleSubscriptionPayment(
  db,
  paymentId,
  actorId = null,
  { testMode = false, providerId = null, note = "" } = {},
) {
  return db.transaction(async (tx) => {
    const p = await one(
      tx,
      "SELECT * FROM subscription_payments WHERE id=$1 FOR UPDATE",
      [paymentId],
    );
    if (!p) fail(404, "Payment not found.");
    if (p.status !== "PENDING") return p;
    const sub = await one(
      tx,
      "SELECT * FROM school_subscriptions WHERE school_id=$1 FOR UPDATE",
      [p.school_id],
    );
    let status = testMode ? "TEST_CONFIRMED" : "PAID";
    if (
      !testMode &&
      (sub.status === "TERMINATED" ||
        (sub.status === "SUSPENDED" &&
          !["TRIAL_EXPIRED", "OVERDUE"].includes(sub.suspension_reason)))
    )
      status = "REVIEW";
    const result = await one(
      tx,
      `UPDATE subscription_payments SET status=$2,paid_at=CASE WHEN $2 IN ('PAID','REVIEW') THEN now() ELSE NULL END,
      reviewed_by=$3,provider_id=COALESCE($4,provider_id) WHERE id=$1 RETURNING *`,
      [p.id, status, actorId, providerId],
    );
    if (status === "PAID") {
      const now = new Date();
      const start =
        sub.plan === "PRO" && new Date(sub.period_end) > now
          ? new Date(sub.period_end)
          : now;
      const end = nextPeriod(start, p.billing_cycle);
      await tx.query(
        "UPDATE school_subscriptions SET plan='PRO',billing_cycle=$2,status='ACTIVE',period_end=$3,suspension_reason='',updated_at=now() WHERE school_id=$1",
        [p.school_id, p.billing_cycle, end],
      );
    }
    await subscriptionEvent(tx, p.school_id, actorId, "PAYMENT_" + status, {
      payment_id: p.id,
      reference: p.reference,
      amount_cents: p.amount_cents,
      method: p.method,
      review_note: note,
    });
    return result;
  });
}
