export function createDocumentStorage() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, ""),
    serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
    bucket = process.env.SUPABASE_STORAGE_BUCKET || "school-documents",
    remote = Boolean(baseUrl && serviceKey);

  if (!remote) throw new Error("Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; incomplete configuration cannot use local storage.");

  async function request(method, key, body, contentType) {
    const response = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
      {
        method,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          ...(body ? { "Content-Type": contentType || "application/octet-stream" } : {}),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Private document storage returned ${response.status}.`);
    return response;
  }

  return {
    async put(key, buffer, contentType) {
      await request("POST", key, buffer, contentType);
    },
    async get(key) {
      return Buffer.from(await (await request("GET", key)).arrayBuffer());
    },
    async delete(key) {
      const response = await fetch(`${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Private document storage returned ${response.status}.`);
    },
  };
}

// Explicit isolated test storage; never used by a running Supabase database.
export function createMemoryDocumentStorage() {
  const documents = new Map();
  return {
    async put(key, bytes) { documents.set(key, Buffer.from(bytes)); },
    async get(key) { if (!documents.has(key)) throw Object.assign(new Error("Document missing"), { code: "ENOENT" }); return Buffer.from(documents.get(key)); },
    async delete(key) { documents.delete(key); },
  };
}
