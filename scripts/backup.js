import "dotenv/config";
import { openDatabase } from "../server/db.js";
import { acquireDataLock, backupDatabase } from "../server/backup.js";
const dataDir = process.env.DATA_DIR || "./data";
const release = await acquireDataLock(dataDir);
let db;
try {
  // A recovery backup must capture the database before any pending migrations.
  db = await openDatabase({ initialize: false });
  console.log(`Backup written to ${await backupDatabase(db, { dataDir })}`);
} finally {
  if (db) await db.close();
  await release();
}
