let csrf = "";
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
      ...options.headers,
    },
    body: options.body
      ? isForm
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });
  const payload = await response.json();
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
      { status: response.status },
    );
  return payload;
}
export const get = async (path) => (await api(path)).data;
export const post = async (path, body) =>
  (await api(path, { method: "POST", body })).data;
export const patch = async (path, body) =>
  (await api(path, { method: "PATCH", body })).data;
