import pg from "pg";
import { supabaseConfiguration } from "./supabase.js";
import { initializeSchema } from "./schema.js";
import { postgresConfiguration } from "./postgres-config.js";
// Keep calendar dates independent of the server machine's timezone.
pg.types.setTypeParser(1082, (value) => value);

export async function openDatabase({
  url = process.env.DATABASE_URL,
  initialize = !process.env.VERCEL,
} = {}) {
  supabaseConfiguration({ ...process.env, DATABASE_URL: url });
  let db;
  {
    const pool = new pg.Pool(postgresConfiguration(url));
    const wrap = (client) => ({
      query: (sql, args = []) => client.query(sql, args),
    });
    db = {
      ...wrap(pool),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(wrap(client));
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  db.backendMode = "supabase";
  {
    try {
      const roles = (
        await db.query(
          "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
        )
      ).rows;
      if (roles.length !== 2)
        throw new Error("DATABASE_URL must point to your Supabase database.");
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  if (initialize) {
    try {
      await db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(736774, 1)");
        await initializeSchema(
          { ...tx, exec: (sql) => tx.query(sql) },
          { protectPublicTables: true },
        );
      });
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  return db;
}
export async function rows(db, sql, args = []) {
  return (await db.query(sql, args)).rows;
}
export async function one(db, sql, args = []) {
  return (await rows(db, sql, args))[0];
}
export async function insert(db, table, values) {
  const keys = Object.keys(values);
  return one(
    db,
    `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(values),
  );
}
export async function audit(
  db,
  user,
  entity,
  id,
  action,
  before = null,
  after = null,
) {
  await insert(db, "audit_logs", {
    school_id: user.school_id,
    user_id: user.id,
    entity_type: entity,
    entity_id: id,
    action,
    previous_value: before ? JSON.stringify(before) : null,
    new_value: after ? JSON.stringify(after) : null,
  });
}
