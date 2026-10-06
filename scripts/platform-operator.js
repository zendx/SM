import "dotenv/config";
import { openDatabase, one, insert, audit } from "../server/db.js";
import { acquireDataLock } from "../server/backup.js";
const email = process.argv[2];
if (!email)
  throw new Error(
    "Usage: node scripts/platform-operator.js administrator@example.com (stop the local server first).",
  );
const release = await acquireDataLock(process.env.DATA_DIR || "./data");
let db;
try {
  db = await openDatabase({});
  const u = await one(
    db,
    "SELECT * FROM users WHERE email=$1 AND role='SUPER_ADMIN' AND status='ACTIVE'",
    [email.toLowerCase()],
  );
  if (!u)
    throw new Error("No active administrator account matches that email.");
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO platform_operators(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [u.id],
    );
    await audit(tx, u, "users", u.id, "PLATFORM_OPERATOR_DESIGNATED");
  });
  console.log(
    "Platform operator access granted to the specified administrator. Other administrators remain school scoped.",
  );
} finally {
  if (db) await db.close();
  await release();
}
