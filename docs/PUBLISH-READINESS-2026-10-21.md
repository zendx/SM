# Root-project deployment and history-cleanup handoff

Date: 21 October 2026.

## Current working arrangement

`C:\xampp\htdocs\SM` is the primary and only application project folder. The user reports that Vercel and the Railway worker are running. This local packaging cleanup does not stop, restart, deploy, migrate, or change the configuration of either service. Prior maintenance statements below describe the earlier migration window, not current service status.

All 115 entries in the former Vercel source ZIP were checked against this root: every file was already present and byte-for-byte identical. No extraction, source replacement, or nested project folder was needed. The redundant ZIP, manifest, and duplicate deployment README have been removed. Continue all application development here.

## Prepared locally

- Remaining tracked `test-results/` files were removed from tracking while preserving local copies: 98 files, including 26 backup archives and 13 uploaded documents.
- Local Git history was rewritten to remove `data/`, `backups/`, `test-results/`, `.npm-cache/`, private `.env` versions and the root `api.js` loader. Both known Vite loader variants were removed from historical blobs, and injected `node api.js` startup/build prefixes were removed.
- The remote branch's extra commit was inspected without executing it. After removing its loader changes, its legitimate file tree matches the cleaned local history. No legitimate remote file changes were discarded.
- Clean baseline HEAD: `5eb77331622ccf90993b96fb1e14fc35b7e0ba3b`. Source remediation remains as working-tree changes for review and commit. Generated `dist/` and `public/` outputs are now ignored/untracked; local copies remain available.
- Nonpublication checkpoint refs and reflogs referencing contaminated history were quarantined, and unreachable original objects were pruned from the checkout. A pre-cleanup Git bundle was encrypted with AES-256-GCM and round-trip verified outside the repository. Its key is protected with the current Windows user's DPAPI and the recovery directory has a current-user-only ACL.
- The private recovery location is recorded locally in ignored `test-results/history-private-root.txt`. Do not upload that directory, its bundle, incident evidence, or its key. Moving a DPAPI key file to another Windows account/machine will not by itself make it decryptable.
- Source hygiene checks now reject private paths and the root loader in both the index and reachable history. CI checks full fetched history before installing/building.

## Deploy from this project root

Use this existing project folder as the Vercel project root (`.`); there is no separate upload project. Framework: **Express**. Build command: `npm run build:vercel`. Output directory: `.` as configured in `vercel.json`. `.vercelignore` excludes private local data, environment files, recovery material, development output, and the Railway worker from Vercel uploads. `.gitignore` prevents private/generated files from being committed.

The Railway worker source remains in `worker/` in this same project. Railway and Vercel use their respective existing configuration files. Keep private environment settings in the hosting services. A GitHub push can automatically deploy Vercel, so local cleanup is not permission to push or redeploy running services.

## Completed maintenance migration

The user confirmed that only **Vercel** auto-deploys on GitHub pushes. Railway deployment is not automatic.

The initial read-only check reported the following blocker, which the maintenance migration has now resolved:

> Schema/protection rollout is incomplete. Apply supabase:setup during coordinated maintenance before deploying.

After the user confirmed that both services were stopped, an encrypted pre-migration backup was completed and verified, then `supabase:setup` was applied successfully. All 82 existing table row counts were preserved; five MFA records were encrypted and successfully decrypted using the unchanged effective key. All 84 application tables are protected. `supabase:check` and the live Vercel preflight now pass. No external credentials or hosting configuration were changed. The Vercel build runs `scripts/vercel-preflight.mjs` before Vite. On Vercel, it checks required configuration, protected schema and new columns, browser-role grants, migration/decryption of MFA and outbox secrets, saved integration decryption, approved public SMTP destinations, and private document bucket settings. A failed check stops the build instead of publishing incompatible application code. Local builds skip cloud checks unless explicitly run with `npm run preflight:vercel`.

## Earlier rollout checklist (historical; do not rerun for packaging cleanup)

1. Pause Vercel automatic deployments and coordinate a maintenance window for the old web application and manually deployed Railway worker. Merely adding schema columns is not the whole migration: encrypted MFA secrets are incompatible with the old application.
2. Review the incident and rotate potentially exposed database/Supabase credentials. A historical `.env` contained database, service-role and integration-key variables. Do not blindly replace the integration/security encryption key: export/re-encrypt saved secrets with the old and new keys under a reviewed rotation plan. Preserve recovery keys securely.
3. Take and verify the normal database-plus-documents recovery backup. Configure the separate backup encryption key/output location and approved tenant SMTP hostnames. Keep the same effective account-security key on web, worker and migration tooling.
4. Follow [the schema/key rollout checklist](SECURITY-HARDENING-2026-10-21.md): apply `npm run supabase:setup`, then `npm run supabase:check` and `npm run preflight:vercel` from a trusted environment. Resolve every failure; do not bypass the preflight.
5. Review and commit the source remediation and index changes. Deploy the web and worker versions together, check login/MFA/activation/document flows, and then resume automatic deployments.

## GitHub history replacement remains separate

GitHub was **not** changed. The observed remote main commit before cleanup was `b176828cf6126d9401d2ad9cc7fbfd6dc5b99074`. Rewritten local history requires a coordinated non-fast-forward replacement; ordinary push/fetch/pull can reject the rewrite or bring contaminated history back.

A background fetch was observed recreating the old remote-tracking refs after cleanup. The local origin configuration now has a negative fetch refspec, `^refs/heads/*`, and `skipDefaultUpdate=true` to quarantine automatic branch fetching until GitHub is cleaned. Restored remote refs/reflogs were cleared again. The original local Git configuration is preserved in the private recovery directory. Explicit refspecs can bypass this quarantine, so do not manually fetch/pull the old branch.

After GitHub's intended branches have been rewritten and verified clean, restore normal fetching with `git config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'` and `git config --unset remote.origin.skipDefaultUpdate`, then fetch the cleaned repository. Do not restore fetching before that verification.

After deployments are paused, changes are reviewed/committed, and collaborators agree, replace only the intended branch using an **explicit lease for the independently rechecked remote commit**. Do not mirror-push internal refs and do not overwrite a remote branch that changed since inspection. Retire old clones/branches/tags that can reintroduce sensitive objects. GitHub PR refs, cached views and server-side retained objects may need a repository administrator/GitHub support cleanup; a force-push alone cannot prove their removal.

No force-push, deployment or external credential rotation was performed. The live schema/MFA migration is complete; the old application cannot read encrypted MFA records and must not be redeployed.

## Final local validation

| Check | Result |
|---|---|
| Complete regression suite | **129 passed; 0 failed/skipped/cancelled**, approximately 261 seconds |
| Vercel preflight regression tests | 4 passed, including fail-closed and credential-safe error checks |
| Fresh ZIP extraction | Fresh `npm ci --ignore-scripts` and `npm run build:vercel` passed from the isolated extracted project; audit reported 0 vulnerabilities |
| Index/history hygiene | No private data/diagnostic/environment paths or known loader primitives found by the hygiene check; no tracked generated build output |
| Package secret scan | No matches for known private configuration values |
| Local preservation | Existing database path and all eight local backup directories retained; 234 working files verified unchanged during history replacement |
| Cleanup | Temporary extraction/dependencies, abandoned mirrors and rewrite tool installation removed; encrypted recovery retained outside the project |
| Live preflight | **Passed:** schema ready, keys verified, private storage; no enabled tenant SMTP destinations |
| Maintenance integrity | All 82 existing table counts unchanged; all 5 MFA records encrypted and decryptable |
| Actual Vercel-mode build | Passed against the migrated live database, including the cloud preflight |
| Backup compatibility follow-up | 10 targeted security/preflight tests passed; real PostgreSQL 17 dump and authenticated archive validation passed |

The former 115-file ZIP was verified against this root and removed at the user's request.
The earlier live rollout gate passed against the configured database. The root is now the deployment source; no archive is needed. The large frontend chunk warning remains nonblocking. The earlier migration required the old releases to remain stopped until compatible versions were deployed; the user now reports both services running. Hosting environment settings, external credential incident response and post-deployment business checks remain operator tasks.


## Maintenance recovery and release handoff

- The pre-migration recovery backup is outside the checkout under the restricted private recovery directory recorded in `test-results/history-private-root.txt`; the exact completed backup path is in `test-results/live-backup-path.txt`. It contains the database and an empty referenced-document map (zero referenced uploads at snapshot time).
- Its separate key is stored as `migration-backup-key.dpapi` in that recovery directory. Recover it with Windows current-user DPAPI; do not upload that file or print the key. Hashes, AES-GCM authentication, archive listing and full `pg_restore` SQL extraction to null passed. An isolated database restore drill is still outstanding. Incomplete attempts have no COMPLETE manifest and must not be used.
- The backup command now opens the database without automatic migration. The dump URL removes application-only connection flags rejected by libpq. Official PostgreSQL 17.11 tools were obtained from [EDB](https://www.enterprisedb.com/download-postgresql-binaries); the vendor archive SHA-256 was `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`. This is the locally measured digest, not an independently authenticated vendor checksum. Temporary downloaded tools were removed afterward.
- Account security still uses the existing integration-key fallback. Keep `INTEGRATION_ENCRYPTION_KEY` unchanged and `SECURITY_ENCRYPTION_KEY` unset on both services, matching the migration configuration. If a dedicated key is already set on either host, resolve that mismatch before starting it; introducing a different dedicated key now breaks decryption. Do not paste secrets into source or GitHub.
- Vercel needs the existing database/Supabase credentials, SSL CA setting, integration key, HTTPS `APP_URL`, and platform email configuration in its private environment. The build preflight checks the actual build environment again. No enabled tenant SMTP integrations exist, so no tenant hostname approvals were required for this migration.
- Railway must be manually released from the same reviewed source revision with the same effective security key and database configuration. Configure durable protected backup storage and its separate backup key where scheduled backups run; Vercel's temporary filesystem is unsuitable for retained backups. Release Railway from this same root checkout; `.vercelignore` excludes the worker only from Vercel uploads.
- For a future coordinated release, deploy and verify both updated services before resuming traffic. Verify a real privileged login/MFA, activation email and document workflow. Do not start the old releases or roll back code alone. External credential rotation and the GitHub history replacement remain outstanding, as described above.

Private execution records: `test-results/live-migration-setup.log`, `live-migration-check.log`, `live-migration-preflight.log`, `live-migration-integrity.json`, `live-backup-verification.json`, and `migration-regression.log`. These are excluded from Git and the upload.
