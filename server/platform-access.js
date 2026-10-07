import { fail } from "./security.js";

export const staffScopes = ["SALES", "TECHNICAL", "SUBSCRIPTIONS"];
export function consoleAccess(user) {
  return !!(user.platform_operator || user.platform_scope);
}
export function requireOwner(req, res, next) {
  if (!req.user.platform_operator) fail(403, "Full owner access required.");
  next();
}
export function requireSubscriptions(req, res, next) {
  if (
    !req.user.platform_operator &&
    req.user.platform_scope !== "SUBSCRIPTIONS"
  )
    fail(403, "Schools and subscriptions access required.");
  next();
}
export function supportDepartment(user) {
  if (user.platform_operator) return null;
  if (!["SALES", "TECHNICAL"].includes(user.platform_scope))
    fail(403, "Customer support access required.");
  return user.platform_scope;
}
