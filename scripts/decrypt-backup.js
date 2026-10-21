import "dotenv/config";
import { decryptBackup } from "../server/backup-crypto.js";
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error(
    "Usage: node scripts/decrypt-backup.js input.enc NEW-output-file",
  );
// decryptBackup refuses existing files and removes new partial plaintext on failure.
await decryptBackup(source, destination);
console.log(
  "Authenticated backup decrypted. Keep plaintext private and remove it after restoration.",
);
