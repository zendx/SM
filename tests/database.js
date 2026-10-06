import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  test as nodeTest,
  before as nodeBefore,
  after as nodeAfter,
} from "node:test";
import { initializeSchema } from "../server/schema.js";
import { postgresConfiguration } from "../server/postgres-config.js";

const available = Boolean(process.env.TEST_DATABASE_URL);
export const test = available
  ? nodeTest
  : (name) =>
      nodeTest(
        name,
        { skip: "Set TEST_DATABASE_URL to a separate test database." },
        () => {},
      );
export const before = available ? nodeBefore : () => {};
export const after = available ? nodeAfter : () => {};

// Test schemas are separate from application tables; never default to DATABASE_URL.
export async function openTestDatabase() {
  if (!available)
    throw new Error(
      "Set TEST_DATABASE_URL to a separate PostgreSQL test database before running integration or browser tests.",
    );
  const schema = "smpis_test_" + randomUUID().replaceAll("-", "");
  const pool = new pg.Pool({
    ...postgresConfiguration(process.env.TEST_DATABASE_URL),
    options: `-c search_path=${schema},public`,
  });
  const wrap = (client) => ({
    query: (sql, args = []) => client.query(sql, args),
  });
  const db = {
    ...wrap(pool),
    isTestDatabase: true,
    backendMode: "supabase",
    exec: (sql) => pool.query(sql),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    },
  };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await initializeSchema(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
