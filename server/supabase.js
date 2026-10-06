import { DOCUMENT_MAX_BYTES } from "./document-limits.js";
const mimeTypes = ["application/pdf", "image/png", "image/jpeg"];

export function supabaseConfiguration(env = process.env) {
  for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"])
    if (!env[name]) throw new Error(`${name} is required. Set it in your private .env file or hosting environment.`);
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("SUPABASE_URL must be the HTTPS project origin.");
  const database = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  if (!["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode")))
    throw new Error("Add sslmode=require (or verify-full with a trusted certificate) to DATABASE_URL.");
  return { url: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
}

export async function prepareDocumentBucket(config, { create = false, fetchImpl = fetch } = {}) {
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" };
  const response = await fetchImpl(`${config.url}/storage/v1/bucket`, {
    headers, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Supabase bucket lookup failed (${response.status}). Check the project URL and service-role key.`);
  const buckets = await response.json();
  const bucket = buckets.find((b) => b.id === config.bucket);
  if (!bucket) {
    if (!create) throw new Error("The document bucket is missing. Run npm run supabase:setup first.");
    const result = await fetchImpl(`${config.url}/storage/v1/bucket`, {
      method: "POST", headers, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ id: config.bucket, name: config.bucket, public: false,
        file_size_limit: DOCUMENT_MAX_BYTES, allowed_mime_types: mimeTypes }),
    });
    if (!result.ok) throw new Error(`Creating the private document bucket failed (${result.status}).`);
    return;
  }
  if (bucket.public !== false)
    throw new Error("The document bucket is public. Make it private in Supabase Storage before continuing.");
  if (Number(bucket.file_size_limit) !== DOCUMENT_MAX_BYTES ||
      !Array.isArray(bucket.allowed_mime_types) ||
      bucket.allowed_mime_types.length !== mimeTypes.length ||
      !mimeTypes.every((mime) => bucket.allowed_mime_types.includes(mime)))
    throw new Error("Set the private bucket limit to 4194304 bytes and allow application/pdf, image/png and image/jpeg only.");
}
