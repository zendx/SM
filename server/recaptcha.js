import { fail } from "./security.js";

export function recaptchaConfig(env = process.env) {
  const siteKey = env.RECAPTCHA_SITE_KEY?.trim() || "";
  const secret = env.RECAPTCHA_SECRET_KEY?.trim() || "";
  if (Boolean(siteKey) !== Boolean(secret))
    fail(
      503,
      "Human verification is not configured correctly. Please contact support.",
      "RECAPTCHA_CONFIGURATION",
    );
  const rawScore = env.RECAPTCHA_MIN_SCORE?.trim() || "0.5";
  const minScore = Number(rawScore);
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
    fail(
      503,
      "Human verification is not configured correctly. Please contact support.",
      "RECAPTCHA_CONFIGURATION",
    );
  return { siteKey, secret, minScore };
}

export async function verifyRecaptcha(
  token,
  { action, env = process.env, request = globalThis.fetch } = {},
) {
  const { secret, minScore } = recaptchaConfig(env);
  if (!secret) return;
  if (typeof token !== "string" || !token.trim() || token.length > 4096)
    fail(
      422,
      "Human verification is required. Please try again.",
      "RECAPTCHA_REQUIRED",
    );
  let result;
  try {
    const response = await request(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error();
    result = await response.json();
    if (typeof result?.success !== "boolean") throw new Error();
  } catch {
    fail(
      503,
      "Human verification is unavailable. Please try again shortly.",
      "RECAPTCHA_UNAVAILABLE",
    );
  }
  if (
    !result.success ||
    typeof action !== "string" ||
    !action ||
    result.action !== action ||
    typeof result.score !== "number" ||
    !Number.isFinite(result.score) ||
    result.score < minScore ||
    result.score < 0 ||
    result.score > 1
  )
    fail(
      422,
      "Human verification failed. Please try again or contact support if this continues.",
      "RECAPTCHA_FAILED",
    );
}

export function requireRecaptcha(action) {
  return async (req, res, next) => {
    try {
      await verifyRecaptcha(req.body?.recaptcha_token, { action });
      next();
    } catch (error) {
      next(error);
    }
  };
}
