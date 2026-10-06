import "dotenv/config";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { seedRoles } from "../server/auth.js";
import { applicationSchema, initializeSchema } from "../server/schema.js";
import { createDocumentStorage } from "../server/document-storage.js";
import { supabaseConfiguration, prepareDocumentBucket } from "../server/supabase.js";

const mode = process.argv[2];
let db;
try {
  if (!["setup", "check"].includes(mode)) throw new Error("Use npm run supabase:setup or npm run supabase:check.");
  const config = supabaseConfiguration();
  db = await openDatabase({ url: process.env.DATABASE_URL, initialize: false });
  const roles = (await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows;
  if (roles.length !== 2) throw new Error("This database is missing Supabase API roles. Check that DATABASE_URL points to your Supabase project.");
  await prepareDocumentBucket(config, { create: mode === "setup" });
  if (mode === "setup") {
    await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(736774, 1)");
      await initializeSchema({ ...tx, exec: (sql) => tx.query(sql) }, { protectPublicTables: true });
      await seedRoles(tx);
    });
  }
  const { tables } = await applicationSchema();
  const records = (await db.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])", [tables],
  )).rows;
  if (records.length !== tables.length || records.some((r) => !r.relrowsecurity))
    throw new Error("Application tables are missing or RLS is disabled. Run npm run supabase:setup.");
  for (const { rolname } of roles) {
    const grants = (await db.query(
      "SELECT table_name FROM unnest($2::text[]) AS t(table_name) WHERE has_table_privilege($1, 'public.' || quote_ident(table_name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')", [rolname, tables],
    )).rows;
    if (grants.length) throw new Error("Supabase browser roles still have application table grants. Run npm run supabase:setup.");
  }
  // Check durable private storage, including the upload MIME restriction and cleanup.
  const storage = createDocumentStorage();
  const key = `deployment-check-${randomUUID()}`;
  const sample = Buffer.from("%PDF-1.4\n% SMPIS storage connectivity check\n%%EOF\n");
  await storage.put(key, sample, "application/pdf");
  try {
    if (!(await storage.get(key)).equals(sample)) throw new Error("Document storage returned different bytes.");
  } finally { await storage.delete(key); }
  console.log(`Supabase ${mode} passed: ${tables.length} protected tables, private bucket, upload/download/delete.`);
} catch (error) {
  // Driver errors may contain connection details. Never print URLs or secret values.
  const message = error.code ? `Database connection/check failed (${error.code}). Check DATABASE_URL and SSL settings.` : error.message;
  console.error(message);
  process.exitCode = 1;
} finally { if (db) await db.close(); }
