import { smtpConfig } from "./integrations.js";
import express from "express";
import { one, rows, insert, audit } from "./db.js";
import { z, id, text, email, password, date } from "./validation.js";
import {
  fail,
  requirePermission,
  hashPassword,
  localClock,
} from "./security.js";
import { currentSchool } from "./services.js";
import { operationsSummary } from "./operations-service.js";
import { provisionSubscription, portalSlug } from "./saas-service.js";
export function forecastSeries(series) {
  if (series.length < 6)
    return {
      status: "INSUFFICIENT_HISTORY",
      required_months: 6,
      available_months: series.length,
      forecast_cents: null,
      mae_cents: null,
      validation_points: 0,
      method: "Mean of the previous three complete calendar months",
    };
  const mean = (a) =>
      Math.round(a.reduce((n, r) => n + Number(r.value), 0) / a.length),
    predictions = [];
  for (let i = Math.max(3, series.length - 6); i < series.length; i++) {
    const predicted = mean(series.slice(i - 3, i));
    predictions.push({
      month: series[i].month,
      actual: Number(series[i].value),
      predicted,
    });
  }
  return {
    status: "BASELINE_ONLY",
    method: "Mean of the previous three complete calendar months",
    forecast_cents: mean(series.slice(-3)),
    mae_cents: Math.round(
      predictions.reduce((n, r) => n + Math.abs(r.actual - r.predicted), 0) /
        predictions.length,
    ),
    validation_points: predictions.length,
    available_months: series.length,
    backtest: predictions,
  };
}
export function intelligenceRoutes(db) {
  const r = express.Router();
  r.get(
    "/intelligence",
    requirePermission("intelligence.read"),
    async (req, res) => {
      const u = req.user,
        school = await currentSchool(db, u),
        today = localClock(school.timezone).date;
      const payments = await rows(
        db,
        "SELECT to_char(paid_at AT TIME ZONE $2,'YYYY-MM') AS month,sum(amount_cents)::text AS value FROM payments WHERE school_id=$1 AND (paid_at AT TIME ZONE $2)::date<date_trunc('month',$3::date)::date GROUP BY 1 ORDER BY 1",
        [u.school_id, school.timezone, today],
      );
      const series = [];
      if (payments.length) {
        let cursor = new Date(`${payments[0].month}-01T00:00:00Z`),
          limit = new Date(today.slice(0, 7) + "-01T00:00:00Z");
        const earliest = new Date(limit);
        earliest.setUTCMonth(earliest.getUTCMonth() - 36);
        if (cursor < earliest) cursor = earliest;
        while (cursor < limit) {
          const month = cursor.toISOString().slice(0, 7);
          series.push({
            month,
            value: Number(payments.find((p) => p.month === month)?.value || 0),
          });
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      }
      const forecast = forecastSeries(series),
        risk = await rows(
          db,
          "SELECT reason,count(DISTINCT student_id)::int AS students FROM at_risk_flags WHERE school_id=$1 AND status='OPEN' GROUP BY reason",
          [u.school_id],
        );
      const families = await one(
        db,
        "SELECT count(DISTINCT parent_user_id)::int AS linked_families,count(DISTINCT parent_user_id) FILTER(WHERE status IN ('ENROLLED','SUSPENDED'))::int AS active_families,count(*) FILTER(WHERE status='WITHDRAWN')::int AS withdrawn_students,count(*) FILTER(WHERE status IN ('ENROLLED','SUSPENDED'))::int AS active_students FROM students WHERE school_id=$1",
        [u.school_id],
      );
      const enrollment = await rows(
        db,
        "SELECT to_char(first_date,'YYYY-MM') AS month,count(*)::int AS students FROM (SELECT min(enrollment_date) AS first_date FROM student_enrollment WHERE school_id=$1 GROUP BY student_id) e GROUP BY 1 ORDER BY 1",
        [u.school_id],
      );
      res.json({
        data: {
          forecast,
          revenue_history: series,
          risk,
          families,
          enrollment,
          operations: await operationsSummary(db, u),
          limitations: [
            "Revenue is recorded cash receipts, not billed revenue. The current incomplete month is excluded.",
            "The forecast is a baseline for planning, not a validated predictive model or a guarantee. Backtesting uses only earlier months.",
            "Family counts describe current linked records. They do not estimate an individual parent’s likelihood of leaving.",
            "Risk flags are explicit support rules. No student is automatically disciplined or classified by a predictive model.",
          ],
        },
      });
    },
  );
  async function operator(req, res, next) {
    if (
      !(await one(
        db,
        "SELECT user_id FROM platform_operators WHERE user_id=$1",
        [req.user.id],
      ))
    )
      fail(403, "An explicitly designated platform operator is required.");
    next();
  }
  r.get("/platform/schools", operator, async (req, res) =>
    res.json({
      data: await rows(
        db,
        "SELECT s.id,s.name,s.short_code,s.currency_code,s.timezone,(SELECT count(*)::int FROM students st WHERE st.school_id=s.id AND st.status='ENROLLED') AS enrolled,(SELECT count(*)::int FROM users u WHERE u.school_id=s.id AND u.status='ACTIVE') AS active_accounts FROM schools s ORDER BY s.name",
      ),
    }),
  );
  r.post("/platform/schools", operator, async (req, res) => {
    const b = z
      .object({
        name: text,
        short_code: text.max(12).regex(/^[A-Z0-9]+$/),
        currency_code: z.string().regex(/^[A-Z]{3}$/),
        timezone: text,
        admin_name: text,
        admin_email: email,
        admin_password: password,
        year_name: text,
        start_date: date,
        end_date: date,
        portal_slug: portalSlug.optional(),
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone });
    } catch {
      fail(422, "Enter a valid timezone.");
    }
    if (b.end_date <= b.start_date)
      fail(422, "Academic year end must follow its start.");
    const result = await db.transaction(async (tx) => {
      const school = await insert(tx, "schools", {
        name: b.name,
        short_code: b.short_code,
        currency_code: b.currency_code,
        timezone: b.timezone,
        portal_slug: b.portal_slug || `school-${b.short_code.toLowerCase()}`,
      });
      await insert(tx, "users", {
        school_id: school.id,
        name: b.admin_name,
        email: b.admin_email,
        password_hash: hashPassword(b.admin_password),
        role: "SUPER_ADMIN",
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
      await provisionSubscription(tx, school, {}, req.user.id);
      await audit(
        tx,
        req.user,
        "schools",
        school.id,
        "PROVISION_SCHOOL",
        null,
        { name: school.name, short_code: school.short_code },
      );
      return school;
    });
    res.status(201).json({ data: result });
  });
  r.get(
    "/integrations/readiness",
    requirePermission("admin.write"),
    async (req, res) =>
      res.json({
        data: {
          app_url: process.env.APP_URL || null,
          https: process.env.APP_URL?.startsWith("https://") || false,
          email_configured: !!(await smtpConfig(db, req.user.school_id)),
          postgresql_configured: db.backendMode === "supabase",
          secure_cookies: process.env.NODE_ENV === "production",
          backup_storage: "Supabase database and private document storage",
          deployment: "Supabase backend",
        },
      }),
  );
  return r;
}
