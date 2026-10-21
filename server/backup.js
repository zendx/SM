import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { backupKey, encryptBackup, fileDigest } from "./backup-crypto.js";
import { createDocumentStorage } from "./document-storage.js";
import { randomUUID } from "node:crypto";
import os from "node:os";
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
  {
    outputRoot = process.env.BACKUP_OUTPUT_ROOT || "./backups",
    storage = createDocumentStorage(),
    dump = postgresDump,
  } = {},
) {
  const key = backupKey();
  const out = path.resolve(
    outputRoot,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(out, { recursive: true });
  const files = [];
  async function save(name, stream) {
    const target = path.join(out, name);
    await encryptBackup(stream, target, key);
    files.push({ name, sha256: await fileDigest(target) });
  }
  // Keep document metadata stable while pg_dump takes its snapshot and bytes are copied.
  await db.transaction(async (tx) => {
    await tx.query("LOCK TABLE student_documents IN SHARE MODE");
    await save("database.dump.enc", dump());
    const documents = (
      await tx.query(
        "SELECT id,storage_key,mime,size FROM student_documents ORDER BY id",
      )
    ).rows;
    for (const document of documents) {
      document.backup_file = `document-${document.id}.enc`;
      await save(
        document.backup_file,
        Readable.from([await storage.get(document.storage_key)]),
      );
    }
    await save(
      "documents.json.enc",
      Readable.from([JSON.stringify(documents)]),
    );
  });
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        engine: "postgresql",
        format: "SMPISBK1 AES-256-GCM",
        scope:
          "SQL and all documents referenced by student_documents; unreferenced storage objects excluded",
        status: "COMPLETE",
        files,
      },
      null,
      2,
    ),
  );
  return out;
}
async function* postgresDump() {
  const url = new URL(process.env.DATABASE_URL);
  const password = decodeURIComponent(url.password);
  url.password = "";
  // These application/driver flags are not accepted by libpq command-line tools.
  for (const name of ["pgbouncer", "uselibpqcompat", "ssl"])
    url.searchParams.delete(name);
  // Preserve SSL parameters; never pass passwords on the command line.
  const env = { ...process.env, PGPASSWORD: password };
  let caFile;
  if (process.env.DB_SSL_CA) {
    caFile = path.join(os.tmpdir(), `smpis-backup-ca-${randomUUID()}.pem`);
    await writeFile(caFile, process.env.DB_SSL_CA.replace(/\\n/g, "\n"), {
      flag: "wx",
      mode: 0o600,
    });
    for (const name of ["sslmode", "sslrootcert", "uselibpqcompat", "ssl"])
      url.searchParams.delete(name);
    env.PGSSLMODE = "verify-full";
    env.PGSSLROOTCERT = caFile;
  }
  const child = spawn("pg_dump", ["--format=custom", "--dbname", url.href], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("pg_dump failed; backup is incomplete.")),
    );
  });
  // Attach a handler immediately, including when spawn itself fails.
  exited.catch(() => {});
  try {
    for await (const chunk of child.stdout) yield chunk;
    await exited;
  } finally {
    if (child.exitCode === null) child.kill();
    if (caFile) await unlink(caFile).catch(() => {});
  }
}
