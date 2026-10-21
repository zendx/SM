import {
  createDocumentStorage,
  createMemoryDocumentStorage,
} from "./document-storage.js";
export async function reconcileDocumentUploads(
  db,
  storage = db.isTestDatabase
    ? createMemoryDocumentStorage()
    : createDocumentStorage(),
) {
  const pending = (
    await db.query(
      "SELECT storage_key FROM document_upload_intents WHERE created_at<now()-interval '1 hour' LIMIT 100",
    )
  ).rows;
  for (const { storage_key: key } of pending) {
    try {
      await db.transaction(async (tx) => {
        const intent = (
          await tx.query(
            "SELECT storage_key FROM document_upload_intents WHERE storage_key=$1 AND created_at<now()-interval '1 hour' FOR UPDATE SKIP LOCKED",
            [key],
          )
        ).rows[0];
        if (!intent) return;
        const referenced = (
          await tx.query(
            "SELECT id FROM student_documents WHERE storage_key=$1",
            [key],
          )
        ).rows.length;
        if (!referenced) await storage.delete(key);
        await tx.query(
          "DELETE FROM document_upload_intents WHERE storage_key=$1",
          [key],
        );
      });
    } catch {
      console.error("Pending document cleanup will be retried.");
    }
  }
}
