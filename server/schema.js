import { readFile } from "node:fs/promises";

export async function applicationSchema() {
  const files = [
    "schema.sql",
    "academic-schema.sql",
    "operations-schema.sql",
    "refinement-schema.sql",
    "integration-schema.sql",
    "site-schema.sql",
  ];
  const sql = (
    await Promise.all(
      files.map((file) => readFile(new URL(file, import.meta.url), "utf8")),
    )
  ).join("\n");
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map(
    (m) => m[1],
  );
  return { sql, tables };
}

export async function initializeSchema(
  db,
  { protectPublicTables = false } = {},
) {
  const { sql, tables } = await applicationSchema();
  await db.exec(sql);
  if (!protectPublicTables) return;
  // Browser Supabase keys must never bypass the application's session/role checks.
  const roles = (
    await db.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
    )
  ).rows;
  const protection = [];
  for (const table of tables) {
    protection.push(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    protection.push(`REVOKE ALL ON TABLE public."${table}" FROM PUBLIC`);
    for (const { rolname } of roles)
      protection.push(
        `REVOKE ALL ON TABLE public."${table}" FROM "${rolname}"`,
      );
  }
  // Apply protection in one round trip rather than hundreds of remote requests.
  await db.exec(protection.join(";\n") + ";");
}
