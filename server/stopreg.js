import { z } from "./validation.js";
import { fail } from "./security.js";

const resultSchema = z.object({
  // Live responses can omit the body status; HTTP success is checked below.
  status: z.literal(200).optional(),
  data: z.object({
    classification: z.object({ is_disposable: z.boolean() }),
    list_match: z.object({ blocklisted: z.boolean() }).optional(),
    policy: z.object({
      action: z.enum(["allow", "warn", "block"]),
      reason_code: z.string().optional(),
    }),
    mail_server: z.object({ mx_found: z.boolean() }).optional(),
  }),
});

export async function screenRegistrationEmail(
  address,
  { apiToken = process.env.STOPREG_API_TOKEN, request = globalThis.fetch } = {},
) {
  // An unconfigured integration leaves the existing verification flow intact.
  if (!apiToken?.trim()) return;
  let result;
  try {
    const response = await request(
      `https://api.stopreg.com/api/v1/verify/email/${encodeURIComponent(address)}`,
      {
        headers: { "x-api-token": apiToken.trim(), Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("Screening unavailable");
    result = resultSchema.parse(await response.json()).data;
  } catch {
    // Never forward provider errors, API credentials or email URLs to clients/logs.
    fail(
      503,
      "We couldn't check your email address right now. Please try registering again shortly.",
      "EMAIL_SCREENING_UNAVAILABLE",
    );
  }
  if (result.classification.is_disposable)
    fail(
      422,
      "You can't register with a disposable or temporary email address. Please use a permanent personal or school email address.",
      "DISPOSABLE_EMAIL",
    );
  if (result.list_match?.blocklisted)
    fail(
      422,
      "This email address or its domain is blocked by our email screening service. Please use another permanent email address or contact SMPIS support if you believe this is a mistake.",
      "EMAIL_BLOCKED",
    );
  if (["warn", "block"].includes(result.policy.action))
    fail(
      422,
      "This email address was flagged by our email screening service and can't be used to register. Please use another permanent email address or contact SMPIS support if you believe this is a mistake.",
      "EMAIL_FLAGGED",
    );
}
