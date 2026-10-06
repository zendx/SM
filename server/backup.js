import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export async function acquireDataLock(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const lock = path.resolve(dataDir, "server.lock");
  try {
    await writeFile(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(await readFile(lock, "utf8"));
    let alive = Number.isInteger(pid) && pid > 0;
    if (alive) {
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
        else throw e;
      }
    }
    if (alive)
      throw new Error(
        `SMPIS data is already in use by process ${pid}. Stop that process before opening this database.`,
      );
    await unlink(lock);
    await writeFile(lock, String(process.pid), { flag: "wx" });
  }
  return async () => {
    try {
      if ((await readFile(lock, "utf8")) === String(process.pid))
        await unlink(lock);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
}
export async function backupDatabase(
  db,
  { dataDir = "./data", outputRoot = "./backups" } = {},
) {
  const out = path.resolve(
    outputRoot,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(out, { recursive: true });
  {
    const url = new URL(process.env.DATABASE_URL);
    const env = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(url.password),
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGDATABASE: url.pathname.slice(1),
    };
    await promisify(execFile)(
      "pg_dump",
      ["--format=custom", `--file=${path.join(out, "database.dump")}`],
      { env, windowsHide: true },
    );
  }
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        engine: "postgresql",
        documents: "Supabase Storage objects are not included",
      },
      null,
      2,
    ),
  );
  return out;
}
