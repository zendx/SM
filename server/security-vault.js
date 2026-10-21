import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "./security.js";

function key() {
  const value =
    process.env.SECURITY_ENCRYPTION_KEY ||
    process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(value || ""))
    fail(
      503,
      "Configure SECURITY_ENCRYPTION_KEY before using account security.",
    );
  return Buffer.from(value, "hex");
}
export function seal(value, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return (
    "v1:" +
    [iv, cipher.getAuthTag(), bytes].map((b) => b.toString("base64")).join(".")
  );
}
export function unseal(value, purpose) {
  if (!value?.startsWith("v1:"))
    fail(503, "Account security migration is required.");
  try {
    const [iv, tag, bytes] = value
      .slice(3)
      .split(".")
      .map((v) => Buffer.from(v, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", key(), iv);
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(bytes), cipher.final()]).toString(
      "utf8",
    );
  } catch {
    fail(503, "Account security data could not be decrypted.");
  }
}
export async function migrateMfaSecrets(db) {
  // Compare-and-swap supports overlapping app starts without overwriting enrollment.
  const { rows } = await db.query(
    "SELECT id,mfa_secret FROM users WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE 'v1:%'",
  );
  for (const user of rows)
    await db.query(
      "UPDATE users SET mfa_secret=$1 WHERE id=$2 AND mfa_secret=$3",
      [seal(user.mfa_secret, `mfa:${user.id}`), user.id, user.mfa_secret],
    );
}
