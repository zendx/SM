import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
import { runJobs } from "./jobs.js";
import { serveFrontend } from "./frontend.js";
const production =
  process.argv.includes("--production") ||
  process.env.NODE_ENV === "production";
const db = await openDatabase();
let app;
try {
  app = await createApp(db, { production });
} catch (error) {
  await db.close();
  throw error;
}
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const server = createHttpServer(app);
// Bind first: another process must not start Vite against the same dependency cache.
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
} catch (error) {
  await db.close();
  if (error.code === "EADDRINUSE")
    throw new Error(
      `Port ${port} is already in use. Stop the existing SMPIS server before starting another.`,
    );
  throw error;
}
let vite;
try {
  if (production) {
    serveFrontend(app, path.resolve("dist"));
  } else {
    const { createServer } = await import("vite");
    vite = await createServer({
      server: { middlewareMode: true, ws: { server } },
      optimizeDeps: { force: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
} catch (error) {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  throw error;
}
console.log(`SMPIS is ready at http://${host}:${port} (Supabase)`);
let running = false;
const jobs = async () => {
  if (running) return;
  running = true;
  try {
    await runJobs(db);
  } catch (error) {
    console.error("Background job failed:", error.message);
  } finally {
    running = false;
  }
};
const timer = setInterval(jobs, 60_000);
timer.unref();
jobs();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    vite?.close();
    server.close(async () => {
      await db.close();

      process.exit(0);
    });
  });
