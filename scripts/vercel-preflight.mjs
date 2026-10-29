import "dotenv/config";
import pg from "pg";
import { postgresConfiguration } from "../server/postgres-config.js";
import {
  supabaseConfiguration,
  prepareDocumentBucket,
} from "../server/supabase.js";
import {
  applicationSchema,
  checkFeeEligibilitySchema,
  checkDirectMessagingSchema,
} from "../server/schema.js";
import { decryptConfig } from "../server/integrations.js";
import { unseal } from "../server/security-vault.js";
import { smtpDestination } from "../server/smtp-policy.js";

// Read-only gate: a Git-triggered build must not publish code against an old schema/key.
export async function checkDeployment() {
  const config = supabaseConfiguration();
  if (!/^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_ENCRYPTION_KEY || ""))
    throw new Error("A valid existing integration encryption key is required.");
  const effectiveKey =
    process.env.SECURITY_ENCRYPTION_KEY ||
    process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(effectiveKey || ""))
    throw new Error("Account security encryption key is invalid.");
  const origin = new URL(process.env.APP_URL || "");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("APP_URL must be the public HTTPS application origin.");
  const pool = new pg.Pool(postgresConfiguration(process.env.DATABASE_URL));
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { tables } = await applicationSchema();
    const installed = (
      await client.query(
        "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])",
        [tables],
      )
    ).rows;
    if (
      installed.length !== tables.length ||
      installed.some((row) => !row.relrowsecurity)
    )
      throw new Error(
        "Schema/protection rollout is incomplete. Apply supabase:setup during coordinated maintenance before deploying.",
      );
    const columns = (
      await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('mfa_last_counter','activation_pending')",
      )
    ).rows;
    if (columns.length !== 2)
      throw new Error("Account security schema migration is incomplete.");
    await checkFeeEligibilitySchema(client);
    await checkDirectMessagingSchema(client);
    for (const role of ["anon", "authenticated"]) {
      const grants = (
        await client.query(
          "SELECT table_name FROM unnest($2::text[]) t(table_name) WHERE has_table_privilege($1,'public.'||quote_ident(table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
          [role, tables],
        )
      ).rows;
      if (grants.length)
        throw new Error(
          "Supabase browser-role permissions require the protected schema rollout.",
        );
    }
    const secrets = (
      await client.query(
        "SELECT id,mfa_secret FROM public.users WHERE mfa_secret IS NOT NULL",
      )
    ).rows;
    if (secrets.some((row) => !row.mfa_secret.startsWith("v1:")))
      throw new Error(
        "Legacy MFA secrets have not been migrated. Coordinate old app/worker shutdown and key migration first.",
      );
    for (const row of secrets) unseal(row.mfa_secret, `mfa:${row.id}`);
    const pending = (
      await client.query(
        "SELECT user_id,encrypted_token FROM public.verification_outbox",
      )
    ).rows;
    for (const row of pending)
      unseal(row.encrypted_token, `verification:${row.user_id}`);
    const integrations = (
      await client.query(
        "SELECT school_id,provider,encrypted_config FROM public.school_integrations",
      )
    ).rows;
    const smtpHosts = new Set();
    for (const row of integrations) {
      const saved = decryptConfig(
        row.encrypted_config,
        row.school_id,
        row.provider,
      );
      if (row.provider === "smtp" && saved.enabled) {
        if (
          ![465, 587].includes(saved.port) ||
          saved.secure !== (saved.port === 465)
        )
          throw new Error(
            "An enabled tenant SMTP integration needs TLS port settings corrected before deployment.",
          );
        smtpHosts.add(saved.host);
      }
    }
    for (const host of smtpHosts) await smtpDestination(host);
    await client.query("ROLLBACK");
    await prepareDocumentBucket(config, { create: false });
    return {
      schema: "ready",
      keys: "verified",
      storage: "private",
      smtpHostsChecked: smtpHosts.size,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}

if (process.env.VERCEL || process.argv.includes("--check")) {
  try {
    console.log(
      "Vercel rollout preflight:",
      JSON.stringify(await checkDeployment()),
    );
  } catch (error) {
    // Do not print database/provider errors, connection strings, or credential values.
    const safe =
      error.message &&
      !error.code &&
      !error.message.includes(process.env.DATABASE_URL || "\0")
        ? error.message
        : "Connection or security checks failed; inspect private configuration and migration state.";
    console.error("Vercel rollout preflight blocked deployment:", safe);
    process.exitCode = 1;
  }
} else
  console.log(
    "Local build: cloud rollout preflight is enforced on Vercel (or explicitly with --check).",
  );
