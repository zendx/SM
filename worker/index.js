import "dotenv/config";
import { openDatabase } from "../server/db.js";
import { runJobs } from "../server/jobs.js";

const intervalMs = 60_000;
const db = await openDatabase({ initialize: false });
let stopping = false;
let timer;
let wakeDelay;

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  wakeDelay?.();
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, stop);

console.log("SMPIS background worker started.");

try {
  while (!stopping) {
    try {
      await runJobs(db);
      console.log("Background job run completed.");
    } catch (error) {
      console.error("Background job run failed:", error);
    }
    if (!stopping)
      await new Promise((resolve) => {
        wakeDelay = resolve;
        timer = setTimeout(() => {
          wakeDelay = undefined;
          resolve();
        }, intervalMs);
      });
  }
} finally {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.removeListener(signal, stop);
  await db.close();
  console.log("SMPIS background worker stopped.");
}
