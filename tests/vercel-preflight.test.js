import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function run(extra, args = []) {
  const env = {
    ...process.env,
    DOTENV_CONFIG_PATH: "test-results/nonexistent-preflight.env",
    ...extra,
  };
  const result = spawnSync(
    process.execPath,
    ["scripts/vercel-preflight.mjs", ...args],
    {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}
test("local source builds do not contact production for deployment preflight", () => {
  const result = run({
    VERCEL: "",
    DATABASE_URL: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Local build/);
});
test("Vercel deployment fails closed without backend configuration and never prints credentials", () => {
  const secret = "private-value-not-for-logs";
  const result = run({
    VERCEL: "1",
    DATABASE_URL: "",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: secret,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked deployment/);
  assert.ok(!(result.stdout + result.stderr).includes(secret));
});
test("explicit rollout check validates keys before opening a database connection", () => {
  const result = run(
    {
      VERCEL: "",
      DATABASE_URL:
        "postgresql://test:private-password@127.0.0.1:1/test?sslmode=verify-full",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "private-service-key",
      SUPABASE_STORAGE_BUCKET: "school-documents",
      INTEGRATION_ENCRYPTION_KEY: "invalid",
    },
    ["--check"],
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /encryption key is required/);
  assert.doesNotMatch(result.stderr, /private-password|private-service-key/);
});
test("Vercel build invokes rollout gate and uploads its script while excluding private artifacts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.ok(
    pkg.scripts["build:vercel"].startsWith(
      "node scripts/vercel-preflight.mjs && ",
    ),
  );
  const ignore = await readFile(".vercelignore", "utf8");
  for (const directory of [
    ".git/",
    "data/",
    "backups/",
    "test-results/",
    ".venv/",
    "deploy/",
  ])
    assert.ok(ignore.split(/\r?\n/).includes(directory), directory);
  assert.ok(ignore.includes("!scripts/vercel-preflight.mjs"));
});
