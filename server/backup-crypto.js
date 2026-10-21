import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, appendFile, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
export function backupKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (!/^[a-f0-9]{64}$/i.test(value || ""))
    throw new Error(
      "Set BACKUP_ENCRYPTION_KEY to a separate 64-character hexadecimal key.",
    );
  return Buffer.from(value, "hex");
}
export async function encryptBackup(input, output, key = backupKey()) {
  const iv = randomBytes(12);
  const stream = createWriteStream(output, { flags: "wx", mode: 0o600 });
  stream.write(Buffer.concat([Buffer.from("SMPISBK1"), iv]));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("SMPISBK1"));
  await pipeline(input, cipher, stream);
  await appendFile(output, cipher.getAuthTag());
}
export async function decryptBackup(input, output, key = backupKey()) {
  const file = await open(input, "r");
  let header, tag, size;
  try {
    size = (await file.stat()).size;
    if (size < 36) throw new Error("Invalid encrypted backup.");
    header = Buffer.alloc(20);
    tag = Buffer.alloc(16);
    await file.read(header, 0, 20, 0);
    await file.read(tag, 0, 16, size - 16);
  } finally {
    await file.close();
  }
  if (header.subarray(0, 8).toString() !== "SMPISBK1")
    throw new Error("Invalid encrypted backup format.");
  const cipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  cipher.setAAD(Buffer.from("SMPISBK1"));
  cipher.setAuthTag(tag);
  const target = await open(output, "wx", 0o600);
  try {
    await pipeline(
      size === 36
        ? Readable.from([])
        : createReadStream(input, { start: 20, end: size - 17 }),
      cipher,
      target.createWriteStream(),
    );
  } catch (error) {
    await target.close().catch(() => {});
    await unlink(output).catch(() => {});
    throw error;
  }
}
export async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
