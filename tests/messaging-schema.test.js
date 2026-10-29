import assert from "node:assert/strict";
import { test, openTestDatabase } from "./database.js";
import { checkDirectMessagingSchema } from "../server/schema.js";

test("deployment refuses messaging without the direct-conversation schema", async () => {
  const db = await openTestDatabase();
  try {
    await checkDirectMessagingSchema(db);
    await db.query("DROP INDEX school_conversations_direct");
    await assert.rejects(
      checkDirectMessagingSchema(db),
      /Direct messaging schema migration is incomplete/,
    );
    await db.query(
      "CREATE UNIQUE INDEX school_conversations_direct ON school_conversations(school_id,parent_user_id,staff_user_id) WHERE student_id IS NULL",
    );
    await db.query(
      "ALTER TABLE school_conversations ALTER COLUMN student_id SET NOT NULL",
    );
    await assert.rejects(
      checkDirectMessagingSchema(db),
      /Direct messaging schema migration is incomplete/,
    );
    await db.query(
      "ALTER TABLE school_conversations ALTER COLUMN student_id DROP NOT NULL",
    );
    await checkDirectMessagingSchema(db);
  } finally {
    await db.close();
  }
});
