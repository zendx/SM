let csrf = "";
const firstSegment = location.pathname.split("/").filter(Boolean)[0];
export const tenantSlug =
  firstSegment &&
  !["terms", "privacy", "cookies", "signup", "login", "owner"].includes(
    firstSegment,
  )
    ? firstSegment
    : "";
export function setCsrf(value) {
  csrf = value;
}
export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      ...(!isForm ? { "Content-Type": "application/json" } : {}),
      "x-csrf-token": csrf,
      ...(tenantSlug ? { "x-smpis-portal": tenantSlug } : {}),
      ...options.headers,
    },
    body: options.body
      ? isForm
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  const payload = await response.json();
  if (response.status === 402)
    window.dispatchEvent(new Event("smpis-subscription-inactive"));
  if (!response.ok)
    throw Object.assign(
      new Error(
        payload.errors
          ?.map(
            (e) =>
              `${e.field ? `${e.field.replaceAll("_", " ")}: ` : ""}${e.message}`,
          )
          .join("\n") || "Request failed.",
      ),
      { status: response.status, code: payload.errors?.[0]?.code },
    );
  return payload;
}
export const get = async (path) => (await api(path)).data;
export const post = async (path, body) =>
  (await api(path, { method: "POST", body })).data;
export const patch = async (path, body) =>
  (await api(path, { method: "PATCH", body })).data;
