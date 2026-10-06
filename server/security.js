import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, hash) {
  const [salt, value] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(value, "hex"));
}
export const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ["*"],
  PROPRIETOR: [
    "dashboard.read",
    "finance.summary",
    "analytics.summary",
    "curriculum.summary",
  ],
  PRINCIPAL: [
    "dashboard.read",
    "students.read",
    "admissions.write",
    "attendance.read",
    "attendance.write",
    "staff.read",
    "staff.attendance.read",
    "finance.summary",
    "reports.students",
    "reports.attendance",
    "classes.write",
    "academics.read",
    "academics.manage",
    "assessments.write",
    "scores.write",
    "reports.generate",
    "reports.finalize",
    "reports.publish",
    "reports.academic.read",
    "analytics.read",
    "curriculum.read",
    "curriculum.manage",
    "curriculum.write",
  ],
  VICE_PRINCIPAL: [
    "academics.read",
    "academics.manage",
    "assessments.write",
    "scores.write",
    "reports.generate",
    "reports.finalize",
    "reports.academic.read",
    "analytics.read",
    "curriculum.read",
    "curriculum.manage",
    "curriculum.write",
    "dashboard.read",
    "students.read",
    "attendance.read",
    "attendance.write",
    "reports.students",
    "reports.attendance",
  ],
  ADMISSIONS_OFFICER: [
    "students.read",
    "students.write",
    "admissions.write",
    "reports.students",
  ],
  TEACHER: [
    "academics.read",
    "assessments.write",
    "scores.write",
    "reports.academic.read",
    "analytics.read",
    "curriculum.read",
    "curriculum.write",
    "students.read",
    "attendance.read",
    "attendance.write",
    "staff.self",
    "reports.attendance",
  ],
  FINANCE_OFFICER: [
    "finance.read",
    "finance.write",
    "finance.summary",
    "reports.finance",
  ],
  HR_OFFICER: [
    "staff.read",
    "staff.write",
    "staff.attendance.read",
    "staff.attendance.write",
    "reports.staff",
  ],
  FACILITIES_MANAGER: ["staff.self"],
  PARENT: [
    "children.read",
    "children.write",
    "finance.own",
    "attendance.own",
    "reports.academic.own",
  ],
  STUDENT: ["reports.academic.own"],
};
for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
  if (!["PROPRIETOR", "PARENT", "STUDENT"].includes(role))
    permissions.push("operations.staff");
  if (["PRINCIPAL", "VICE_PRINCIPAL"].includes(role))
    permissions.push(
      "discipline.manage",
      "complaints.manage",
      "operations.summary",
    );
  if (role === "TEACHER") permissions.push("discipline.report");
  if (["PRINCIPAL", "HR_OFFICER"].includes(role)) permissions.push("hr.manage");
  if (["PRINCIPAL", "FACILITIES_MANAGER"].includes(role))
    permissions.push("facilities.manage");
  if (role === "PARENT") permissions.push("experience.own");
  if (["PRINCIPAL", "PROPRIETOR"].includes(role))
    permissions.push("intelligence.read", "operations.summary");
}
export const permitted = (u, p) =>
  u.permissions.includes("*") || u.permissions.includes(p);
export function fail(status, message, code = "VALIDATION_ERROR") {
  throw Object.assign(new Error(message), { status, code });
}
export function requirePermission(p) {
  return (req, res, next) => {
    if (!permitted(req.user, p))
      return next(
        Object.assign(new Error("Your role cannot perform this action."), {
          status: 403,
          code: "FORBIDDEN",
        }),
      );
    next();
  };
}
export function localClock(timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
export function cents(value) {
  const str = String(value);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(str))
    fail(422, "Enter a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = str.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const invoiceStatus = (i, today) =>
  i.waived
    ? "WAIVED"
    : Number(i.paid_cents) === Number(i.total_cents)
      ? "PAID"
      : String(i.due_date).slice(0, 10) < today
        ? "OVERDUE"
        : Number(i.paid_cents) > 0
          ? "PARTIAL"
          : "UNPAID";
