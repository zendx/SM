# Security remediation and deployment notes

Security configuration, deployment and recovery reference.

## Critical additional finding: build configuration loader

During remediation, an obfuscated loader was found appended after the normal export in `vite.config.js`. The original assessment missed it. It was already present in the assessed Git baseline; the last commit touching that file was `178c76c` dated 14 October 2026. This identifies repository history, not the person or mechanism responsible for the addition.

The appended code contains remote-content discovery/retrieval, `eval`, and detached Node process execution paths. It is unrelated to the application build configuration. The loader and its unused `createRequire` setup have been removed. Do not execute historical copies of this configuration.

Original file SHA-256:

```text
2d2d01b5e44c30a52e95c925bf0e01ec439e087d6c487c060459fe3501501524
```

A non-executable evidence copy and inventory are preserved under ignored `test-results/security-incident/`. Keep these private if retained elsewhere. The scan for this loader's markers found no matches in the remaining first-party source, `public`, `dist`, or installed dependency JavaScript. This targeted search does not prove that the workstation or dependencies are uncompromised.

The assessment's earlier build used the affected configuration. This review cannot establish whether a remote payload was retrieved or executed. Treat credentials available to historical builds as potentially exposed until incident review establishes otherwise. Review build/host/network logs, repository access and the introducing change; rebuild from reviewed source in a trusted environment and rotate potentially affected credentials using normal service procedures. No external credentials were rotated and no Git history was rewritten during this work.

## Implemented changes

| Finding | Local remediation | Remaining operational work |
|---|---|---|
| WB-01 | `data/` and `backups/` ignored and removed from the Git index. All local copies preserved. Source hygiene check rejects tracked operational data. | Commit the index removals; investigate old copies and repository exposure. Coordinate historical removal and credential rotation where necessary. |
| WB-02 | Both setup POST routes require a deployment token of at least 32 characters. No configured token means setup is denied. Owner setup UI accepts the token. Existing atomic one-owner checks remain. | Configure a temporary token only when bootstrapping, distribute privately, remove after setup. |
| WB-03 | MFA secrets use versioned AES-256-GCM ciphertext bound to the user ID. Legacy plaintext secrets are encrypted during app startup and Supabase setup using compare-and-swap updates. | Preserve the security encryption key; run schema/setup before deployment. Historical plaintext copies still require exposure review. |
| WB-04 | TOTP verification locks the user record and atomically records the last accepted counter. Enrollment also consumes its code. Reused/older counters fail across sessions. Recovery codes remain single-use. | Users must wait for a new code after enrollment if signing in again immediately. |
| WB-05 | Owners, console staff, school super administrators, principals/vice principals, finance and HR officers must enroll in MFA before accessing ordinary APIs. Existing enrolled users must verify each new session. Dedicated enrollment screen works before school configuration loads. | Notify privileged users; prepare audited operator-assisted recovery. Existing unprotected sessions are enrollment-restricted on their next request. |
| WB-06 | Role-account creation generates an unknown random password, sets activation pending, and emails a 30-minute hashed-token activation link. The recipient chooses their password through the existing reset screen. Token consumption clears activation pending and verifies mailbox control. Initial passwords are no longer displayed in the creation form or email templates. | Previously emailed passwords are not automatically revoked. Review/reset affected existing accounts as appropriate. |
| WB-07 | Tenant SMTP is restricted to exact platform-approved hostnames and TLS/STARTTLS ports 465/587. Resolution is checked for internal/reserved addresses and the chosen public IP is pinned into the actual transport, with TLS hostname/certificate verification preserved. | Configure `SMTP_ALLOWED_HOSTS` for existing legitimate integrations and enforce network egress controls. Platform `SMTP_URL` remains trusted deployment configuration. |
| WB-08 | Registration commits a pending user, hashed verification token, and encrypted delivery outbox before attempting SMTP. The worker claims/retries delivery, and transports have short timeouts. Failed SMTP preserves a pending registration instead of rolling back a delivered token/account transaction. Expired security tokens/sessions are cleaned by the worker. | Keep web and worker on the same schema and encryption key. Monitor failed delivery and SMTP configuration. |
| WB-09 | Backups stream SQL directly into AES-256-GCM encrypted output and include every document referenced in SQL, plus an encrypted object map. Document metadata is locked during snapshot/copy. A completion manifest lists ciphertext SHA-256 digests. Decryption refuses overwrite and removes partial plaintext on authentication failure. | Set a separate backup key and protected output root, enforce retention/access controls, and perform a real Supabase/pg_dump restore drill. Existing old archives remain unchanged. |
| WB-10 | Vite updated to 8.3.5; source-map-js resolves to 1.2.2. Lockfile updated. Audit reports zero vulnerabilities at remediation time. | Continue monitoring advisories and running the CI audit. |
| WB-11 | Upload intents are durable before object creation. Metadata and audit commit together. Failed metadata/audit triggers immediate object deletion; stale intents are reconciled by the worker without deleting referenced objects. | Monitor repeated cleanup failures and retain the worker. |
| WB-12 | Obfuscated build loader removed. Source hygiene checks run before CI installation/build. | Incident review and potentially affected credential rotation remain required. |

The checks do not certify cloud settings or erase old exposures. Historical data, workstation compromise, cloud credentials, managed backup retention and live restoration are operational tasks, not resolved by changing source files.

## Deployment order

1. Review these changes and the loader evidence from a trusted environment. Keep the existing web/worker versions together until ready to switch.
2. Preserve `INTEGRATION_ENCRYPTION_KEY`. Optionally configure a separate 64-hex-character `SECURITY_ENCRYPTION_KEY` **before first deployment of these changes**. If absent, account security uses the existing integration key for compatibility. Once ciphertext/outbox records are created, preserve the same effective key across web, worker, migrations and restores. Do not introduce/change the dedicated key afterward without decrypting and re-encrypting existing security records with both keys.
3. Configure `SMTP_ALLOWED_HOSTS` with comma-separated exact public SMTP hostnames approved by the platform operator. Existing saved tenant SMTP settings outside this list will be rejected until approved. Use port 465 with `secure:true`, or 587 with `secure:false` and mandatory STARTTLS. Private SMTP relays are intentionally unsupported for tenant configuration; a deployment-controlled platform relay can use `SMTP_URL`.
4. Run `npm ci --ignore-scripts` from reviewed package manifests. Run `npm run supabase:setup` with the new source and effective security key to apply `hardening-schema.sql`, protect its new tables, and encrypt legacy MFA secrets. This command targets the configured cloud database: take the normal deployment backup first. The command was **not run against the application database** during remediation.
5. Deploy the web app and worker together. Vercel runtime does not apply schema migrations. The new app expects the new columns/tables. Keep the security key available to the worker for verification delivery.
6. Existing owners continue signing in with their accounts. Privileged accounts without MFA see enrollment before administrative access. Scan the QR code, verify the current authenticator code, then save recovery codes in Account security. School users must enroll even if a subscription has expired; authentication endpoints remain accessible for enrollment.
7. Only for a fresh installation, configure a random `BOOTSTRAP_TOKEN` of at least 32 characters and enter it in owner setup (or send `x-bootstrap-token` in a trusted setup client). Both setup routes are disabled without it. Remove the environment variable after setup completes; the database also prevents repeated initialization.
8. Configure a separate 64-hex-character `BACKUP_ENCRYPTION_KEY` and an access-controlled `BACKUP_OUTPUT_ROOT`, preferably outside the checkout. Save this key separately from backup storage. Run a backup and conduct an isolated restoration drill before relying on recovery coverage.
9. Verify real Supabase RLS/browser grants, private bucket settings, HTTPS/proxy configuration, worker operation, activation delivery, MFA recovery and approved SMTP delivery on the deployment.

Rollback requires care: the old application cannot read encrypted MFA secrets and does not understand activation-pending accounts. Do not roll back only the code. Prefer a forward fix; if rollback is essential, use a reviewed migration/restore plan that preserves security and delivery state.

## Backup and restoration procedure

`npm run backup` writes only encrypted data files and a completion manifest. A directory without a `COMPLETE` manifest is an incomplete backup and must not be used as a successful recovery point. The scope includes SQL and **referenced** documents, not unreferenced bucket objects. It does not back up deployment environment secrets or provider-side state.

For an isolated recovery environment:

1. Verify each manifest SHA-256 digest against its encrypted file. Keep the output directory private; Windows operators should use restricted NTFS ACLs, since POSIX mode flags alone do not set equivalent Windows access control.
2. With the recovery key available privately, use `node scripts/decrypt-backup.js <encrypted-file> <new-output-file>` to authenticate/decrypt `database.dump.enc`, `documents.json.enc`, and each `document-<id>.enc`. The helper will not overwrite existing files. Never restore a file for which authentication failed.
3. Restore the database dump with `pg_restore` into an isolated compatible PostgreSQL/Supabase environment. Restore each document using its original `storage_key` and `mime` from the decrypted object map into a private configured bucket.
4. Configure the original integration/security keys, run the reviewed schema/protection checks, and compare SQL document metadata with recovered objects. Validate representative document downloads, login/MFA, tenant isolation, financial totals and background queues. Disable outbound email/payment effects during the drill.
5. Record the measured recovery point/time and the outcome. Remove temporary plaintext under the organization's data-handling procedure.

No real database dump or live restore was attempted here. Automated backup verification uses synthetic SQL/document bytes and tests round-trip recovery and ciphertext tampering; it does not substitute for the drill above.

## Regression strategy

`tests/security-hardening.test.js` imports the real application factory and exercises the production authentication policy. Existing business-workflow tests import `tests/app.js`, which explicitly supplies authorized bootstrap headers and disables mandatory enrollment **only for objects marked as isolated test databases**; the application rejects that option for normal databases. This keeps permission/workflow fixtures independent of enrollment while the new tests verify the production restriction itself. No production environment variable disables mandatory privileged MFA.

The GitHub Actions workflow checks source hygiene before running dependency installation, audit, embedded tests and a build. The source hygiene check is a narrow regression guard against operational files and unexpected execution primitives in Vite configuration; it is not a malware scanner or replacement for code review.

Final local validation results are recorded in the assessment remediation addendum.

## Subsequent publication preparation

Deployment is guarded by the read-only Vercel preflight. Apply required schema migrations before deploying compatible web and worker releases. Preserve encryption keys and verify recovery backups.
