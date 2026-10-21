# SMPIS white-box assessment

**Assessment date:** 21 October 2026 (Africa/Lagos)  
**Source baseline:** `096deeafec94e6d5de9fc062d487fe43b97b0423`  
**Workspace:** `C:\xampp\htdocs\SM`  
**Classification:** Internal — security-sensitive findings  
**Assessment type:** Source-assisted security, architecture, reliability, and test review.

**Remediation update:** Source changes and a newly discovered critical build-loader finding are documented in [Security remediation and deployment notes](SECURITY-HARDENING-2026-10-21.md). The findings below describe the original baseline; see the remediation addendum at the end for current validation and unresolved deployment/history work. The initial assessment missed the loader in `vite.config.js`.

## 1. Executive assessment

SMPIS is a substantial multi-tenant school management application. It combines student admissions, attendance, academic results, finance, school subscriptions, platform support, notifications, and reporting. The backend is Node.js/Express with PostgreSQL/Supabase and private object storage; the frontend is React/Vite. A separate worker processes scheduled work and email delivery.

The application has meaningful security controls: parameterized query values, explicit role permissions, tenant-aware record access, parent/teacher restrictions, CSRF tokens, hashed session and recovery tokens, private document storage, authenticated encryption for integration credentials, signed payment webhooks, and transactional financial settlement. Existing tests exercise many of these controls through HTTP and an actual embedded PostgreSQL engine.

The most urgent confirmed issue is that **1,378 files under `data/` and `backups/` are tracked in Git**, including a PostgreSQL cluster and database backup archives. Their presence is confirmed; whether they contain real school information or live credentials was deliberately not established by opening or restoring the databases. Repository access therefore requires immediate review.

The first platform owner can also be created through an unauthenticated public endpoint on an uninitialized installation. A local isolated probe successfully created an owner without a bootstrap secret. This is a **critical-impact, deployment-dependent bootstrap risk**, assessed High because exploitation requires an installation with no existing owner and configured registration email delivery.

Other findings concern MFA secret protection and replay, optional privileged MFA, emailed reusable passwords, tenant-controlled SMTP destinations, verification email delivery inside locked transactions, incomplete backup coverage, and vulnerable development dependencies. These findings warrant remediation before treating this review as evidence of production readiness.

This assessment does not establish that a deployed system has been compromised. It does not certify the absence of other defects, and it does not assert that every line or every possible execution path was verified.

## 2. Scope, approach, and boundaries

### Reviewed surfaces

| Area | Principal files/surfaces | Review focus |
|---|---|---|
| HTTP entry points | `server/app.js`, `server/index.js`, root `index.js` | Middleware order, production controls, origin checks, errors, deployment differences |
| Authentication | `server/auth.js`, `security.js`, `validation.js`, `email-verification.js` | Bootstrap, password reset, cookies, CSRF, session state, MFA |
| Authorization | `services.js`, `academic-service.js`, route modules, `platform-access.js` | Tenant boundaries, role guards, parent/teacher ownership, owner designation |
| Core workflows | `routes.js`, `services.js`, academic/operations/refinement modules | Admissions, invoice/payment invariants, result publication and historical records |
| Payments | `paystack.js`, `school-payments.js`, `saas-providers.js`, `saas-routes.js` | Signatures, provider verification, amount/currency/mode binding, settlement locks |
| Data | `db.js`, schema loader and SQL schemas, `postgres-config.js` | Parameterization, transaction boundaries, constraints, RLS provisioning |
| Integrations | `integrations.js`, `document-storage.js`, `supabase.js`, `recaptcha.js`, `stopreg.js` | Secret handling, destination control, storage restrictions, external failures |
| Communications | Account emails, email templates, consent, notifications, onboarding, jobs | Credential exposure, consent, claims/retries, delivery consistency |
| Frontend | `src/`, frontend serving, build configuration | Dangerous execution/HTML sinks, browser storage, build results |
| Operations | Backup implementation, worker, deployment configuration, tracked artifacts | Recovery completeness, source hygiene, environment dependencies |
| Tests/dependencies | Test harness, existing suite, package manifests/installed dependency tree | Reproducibility, isolated execution, advisory exposure |

### Methods

1. Enumerated application files and inspected the package scripts, entry points, security helpers, and test harness.
2. Traced representative sensitive requests from middleware through routes/services to SQL or external providers.
3. Searched source for dangerous HTML/execution sinks, secret fields, outbound requests, uploads, and authorization patterns.
4. Ran the existing test suite with `node scripts/test-embedded.mjs`, which explicitly uses PGlite rather than the application database.
5. Added and ran an assessment-only local probe against a fresh in-memory database for owner bootstrap, optional owner MFA, readable MFA secrets, and TOTP replay.
6. Ran `npm audit --json`, inspected the installed Vite/source-map-js dependency chain, and built the frontend.
7. Reviewed tracked artifact names and counts without extracting database archives or exposing environment values.

The baseline working tree was clean. No application-source remediation, package upgrades, database changes, live payment requests, external email deliveries, or production attacks were performed. The assessment probe mocks SMTP. The production build regenerated `dist/`; those generated changes were reverted to preserve the baseline. The report is the intended tracked deliverable; diagnostic output is in ignored `test-results/`.

### Limitations

- No live Supabase database, bucket permissions, network policies, hosting configuration, TLS certificate, production logs, or actual provider configuration was inspected.
- No real PostgreSQL concurrency/load test or browser automation was run during this assessment. Embedded test results do not prove cloud configuration or every PostgreSQL locking behavior.
- No brute-force, resource exhaustion, antivirus-evasion, destructive test, or backup restore was attempted.
- Dependency audit data is time-sensitive and reflects the registry response obtained on the assessment date. Finding a vulnerable version does not by itself demonstrate a reachable exploit.
- The private `.env` was not printed or included in the report. Historical Git secrets and the contents of database binaries were not comprehensively scanned.
- This is an engineering assessment, not a legal compliance determination or formal exhaustive ASVS certification.

## 3. Architecture and trust boundaries

```text
Browser / anonymous caller
    -> Express public routes: signup, setup, admissions, consent, authentication
    -> Session authentication + CSRF + MFA gate + subscription gate
    -> Tenant and role checks in routes/services
    -> PostgreSQL application connection
    -> Supabase private documents / SMTP / payment providers

Payment providers -> signed webhook routes -> provider verification / settlement
Background worker -> shared PostgreSQL -> email and scheduled lifecycle processing
Platform operators -> explicit designation -> cross-school administration
```

Important consequences:

- PostgreSQL application access is privileged relative to browser Supabase roles. Application-level tenant checks remain essential; enabling RLS without tenant policies does not isolate tenants from the backend connection.
- A full operator can select a school using `x-smpis-portal` and receive school `SUPER_ADMIN` permissions. This appears intentional and makes owner account security particularly important.
- Payment webhook routes execute before ordinary session/CSRF middleware. Their signature and transaction verification are their security boundary.
- School administrators can configure outbound SMTP. Their trust level must be considered separately from server/network administrators.
- Object bytes live outside the SQL database. A successful SQL backup cannot by itself recover documents.

## 4. Finding register

Severity reflects impact, prerequisites, and the observed application context; advisory severity is separately identified where appropriate. “Confirmed” describes code or local behavior, not exploitation in production.

| ID | Severity | Finding | Evidence status |
|---|---|---|---|
| WB-01 | High | Database cluster and backups are tracked in source control | Confirmed inventory; contents/external distribution unknown |
| WB-02 | High | First owner bootstrap is publicly claimable | Confirmed isolated HTTP probe; uninitialized deployments only |
| WB-03 | Medium | MFA shared secrets are stored as readable database text | Confirmed source and database probe |
| WB-04 | Medium | TOTP codes can be reused across separate sessions | Confirmed isolated HTTP probe |
| WB-05 | Medium | Privileged accounts may operate without MFA | Confirmed behavior; security-hardening policy gap |
| WB-06 | Medium | New users receive reusable initial passwords by email | Confirmed source and existing test behavior |
| WB-07 | Medium | Tenant SMTP configuration permits internal network destinations | Confirmed unrestricted configuration path; network exploit untested |
| WB-08 | Medium | Registration sends email while holding database transactions/locks | Confirmed code path; outage/load impact not benchmarked |
| WB-09 | Medium | Backup command excludes document objects and does not encrypt output | Confirmed implementation; external recovery controls unknown |
| WB-10 | Medium* | Installed development dependencies have high-severity advisories | Confirmed audit; production exploit reachability not established |
| WB-11 | Low | Document object creation lacks compensation for metadata failure | Confirmed source failure path |
| WB-12 | Critical | Obfuscated remote-code loader appended to Vite build configuration | Discovered during remediation; confirmed static code, remote payload execution unknown |

*WB-10 can become High when a vulnerable development service is reachable under the advisory prerequisites. This is not evidence of production remote code execution.*

### WB-12 — Obfuscated build configuration loader (remediation discovery)

The assessed version of `vite.config.js` contains an obfuscated loader appended to its otherwise normal configuration export. Its code includes remote-content retrieval, `eval`, and detached process execution. This is a direct build/developer execution risk, distinct from the conditional dependency advisories. The original assessment did not inspect this appended code and missed it. The earlier build used the affected configuration; whether it successfully retrieved/executed a payload is unknown. The loader is removed in the remediation working tree; the original file hash, evidence location, incident limitations and operational response are documented in the linked remediation notes. Historical copies and potentially exposed credentials remain outside the completed source fix.

### WB-01 — Database material committed to Git

**Evidence:** `git ls-files data backups` returns 1,378 paths: 1,362 under `data/` and 16 under `backups/`. Examples include `data/postgres/base/...`, `data/postgres/PG_VERSION`, and dated `backups/.../database.tar.gz` archives. `.gitignore` excludes `.env`, dependencies, and diagnostics, but does not exclude these two directories. `.vercelignore` excludes them from that deployment path; that does not remove repository copies.

**Impact:** Anyone with repository or relevant historical clone access may obtain database material. If populated with real records, the exposure could include student/guardian/staff data, password hashes, and readable MFA secrets. Encrypted integration fields remain dependent on separate encryption-key protection. Database archives are not proved to contain real data in this review.

**Remediation:** Establish the provenance and contents in a controlled environment. Move operational data and backups outside the source tree, add ignore rules, and remove tracked copies. If sensitive contents were committed, coordinate history cleanup and access review; removing current files alone does not revoke historical access. Rotate affected credentials/tokens based on confirmed exposure, preserve any required incident evidence, and place backups in access-controlled encrypted storage.

**Acceptance:** No operational database or archive paths appear in `git ls-files`; historical exposure is documented and addressed; clean clones contain no school data; automated repository checks prevent recurrence.

### WB-02 — Unauthenticated first-owner claim

**Evidence:** `server/auth.js:128` registers `POST /api/v1/auth/owner/setup` on the public auth router. It checks whether a platform operator exists, but requires no deployment secret or trusted operator identity. It inserts a `PLATFORM_OWNER` user and a `platform_operators` row. `POST /auth/setup` at line 233 similarly creates an administrator with platform designation on a fresh installation. GET setup endpoints reveal whether initialization is available.

The isolated probe sent an ordinary JSON POST with name, email, and password, received **201**, and observed **one platform operator**. The probe then verified the mocked email and successfully signed in.

**Prerequisites:** An uninitialized database, publicly reachable setup route, and functioning verification-email configuration. Email verification proves control of the submitted mailbox; it does not prove authorization to own the deployment. Transaction locks prevent simultaneous winners but do not identify the legitimate owner.

**Impact:** The first successful caller can acquire platform-wide control. A failed/partial deployment or newly provisioned environment can expose this window.

**Remediation:** Provision the initial owner through the existing operator CLI or another deployment-only channel. If HTTP setup must remain, disable it by default and require a high-entropy one-time bootstrap secret validated before work begins. Restrict network access during initialization and permanently close both setup paths afterward.

**Acceptance:** Fresh installations reject anonymous owner creation without explicit deployment authorization, even when SMTP is configured. Authorized initialization remains atomic and single-use.

### WB-03 — Readable TOTP secrets

**Evidence:** `server/schema.sql:13` defines `mfa_secret TEXT`. `server/auth.js:610` writes the Base32 secret directly, and verification constructs TOTP directly from that value. The probe compared the enrollment response with the stored value and returned `true`.

**Impact:** A read-only database or backup disclosure can supply the second factor for affected accounts. This compounds WB-01. Passwords are still separately required; this is not a passwordless bypass.

**Remediation:** Encrypt TOTP secrets with authenticated encryption and user-bound associated data. Keep the encryption key outside SQL and backups, version encrypted values, and plan rotation/migration. Recovery codes are already hashed and should remain so.

**Acceptance:** Stored values differ from enrollment secrets; ciphertext cannot be swapped between users; bad tags fail closed; existing users migrate without silently disabling MFA.

### WB-04 — Reusable TOTP across sessions

**Evidence:** `server/auth.js:593` validates a token with `window: 1` and marks the session verified, but does not record or atomically consume the accepted TOTP time step. After MFA enrollment, the probe logged in twice and submitted the **same code** to both sessions. Both verification responses were **200**.

**Impact:** A code intercepted alongside a password may be reused during its accepted time window. Existing MFA IP/account limits reduce guessing but do not prevent valid-code replay. Single-use recovery-code consumption is already transactional.

**Remediation:** Store the last accepted TOTP counter and atomically advance it only for a newer valid counter. Handle tolerated clock skew explicitly. Consider regenerating the session/CSRF credentials on successful MFA verification.

**Acceptance:** The first use succeeds; repeat or concurrent use of that same time-step code fails, including from another session. A later valid code succeeds.

### WB-05 — Optional MFA for highly privileged users

**Evidence:** `publicUser()` returns `mfa_setup_required: false` (`auth.js:60`). Login sets `mfa_verified: !u.mfa_enabled`; enforcement therefore applies only to users who enrolled. The probe signed in as owner with `mfa_required: false` and `setupRequired: false`. The existing suite explicitly tests optional administrator enrollment. Reminder emails do not change enforcement.

**Impact:** Owner, school administrator, finance, and support access may depend on a password alone. A stolen owner password can have cross-school consequences.

**Remediation:** Require MFA for full operators and privileged roles, using a bounded enrollment flow and an audited recovery process. Provide safe account recovery before rollout to avoid lockouts. Treat this as a deliberate policy change, because the current behavior is intentional and tested.

**Acceptance:** Privileged users without enrollment can access enrollment/logout/recovery flows but cannot administer schools, finances, or platform settings. Enrolled users remain gated until verification.

### WB-06 — Reusable passwords delivered in email

**Evidence:** `auth.js` passes `b.password` into `sendAccountCreatedEmail()` after creating a user. `server/account-created-email.js` supplies `password: initialPassword` to the template. `server/email-templates.js` includes “Initial password: {{password}}”. Changing the password is advisory; no first-login password-change state was observed in this flow.

**Impact:** Mailboxes, forwarding rules, SMTP providers, and email retention become additional stores of a working password. An administrator also knows the initial password until it is changed. Keeping credentials out of the database queue/audit is good but does not eliminate mailbox persistence.

**Remediation:** Replace password delivery with a short-lived, single-use account activation link whose token is stored hashed. Let the recipient choose a password and mark activation explicitly. If temporary passwords must remain temporarily, force replacement before ordinary access and expire them quickly.

**Acceptance:** Account emails contain no usable password, activation tokens cannot be replayed, expired links fail, and a newly provisioned user cannot use privileged features before completing activation.

### WB-07 — Tenant-controlled SMTP connections to internal addresses

**Evidence:** `server/integrations.js` accepts a hostname and ports 1–65535. Validation rejects whitespace/slashes/colon syntax in the hostname but does not reject IPv4 loopback, private ranges, internal names, or hostnames resolving to them. `smtpConfig()` passes these fields into Nodemailer. School `SUPER_ADMIN` users can save the configuration. Subsequent account/reset/notification delivery connects from the server or worker.

**Impact:** A malicious tenant administrator can cause SMTP-protocol outbound connections to destinations reachable from the application network. Potential effects include internal service interaction, constrained port probing, and delivery failures. This review did not demonstrate arbitrary HTTP requests, metadata access, data exfiltration, or an internal compromise.

**Remediation:** Prefer platform-managed SMTP or a verified provider allowlist. If arbitrary tenant hosts are required, enforce destination policy at DNS resolution and connection time for IPv4/IPv6, reject private/link-local/loopback ranges, account for DNS rebinding, restrict ports, and enforce network egress controls. Require TLS/STARTTLS where credentials are used; `secure:false` alone does not require STARTTLS.

**Acceptance:** Internal, loopback, link-local, and rebinding destinations fail safely; approved public providers still work; tests cover alternative address forms and IPv6.

### WB-08 — External email delivery inside locked transactions

**Evidence:** Owner and legacy setup acquire exclusive table locks (`auth.js:136`, `263–264`) and call `sendVerification()` before committing. School registration also calls verification within its transaction (`saas-service.js:198`). `email-verification.js:17` performs network delivery directly and does not set explicit short transport timeouts in this path.

**Impact:** Slow SMTP retains transactions and, on bootstrap, exclusive locks while waiting on an external service. Failed/late transactions can also leave a delivered email referring to a token rolled back from SQL. Resource exhaustion and dead-link frequency were not measured.

**Remediation:** Insert pending registration/token and a durable outbox record atomically, then send after commit with bounded timeouts and retry policy. Keep pending users unable to sign in until verification succeeds. Do not hold broad setup locks while awaiting network I/O.

**Acceptance:** Slow or failing SMTP does not hold initialization locks/transactions; committed pending accounts receive retryable verification; duplicate deliveries remain safe; dead tokens from rolled-back registration are avoided.

### WB-09 — Incomplete and unencrypted application backup output

**Evidence:** `server/backup.js:38` executes `pg_dump --format=custom` into a local backup directory. The manifest explicitly states that Supabase Storage objects are not included (`line 69`). No output encryption, retention enforcement, integrity verification, or restore test is implemented in this function. README documents that database and document recovery must be configured separately.

**Impact:** Restoring SQL alone can recreate document metadata without the actual files. Local dumps can expose database contents if copied or accessed improperly; WB-01 demonstrates that archives have entered source control. External managed backups may mitigate the operational gap, but were not verified.

**Remediation:** Implement/document a coordinated SQL plus object-storage recovery procedure; encrypt backups, protect keys separately, restrict access, verify checksums, and test restores in isolation. Record recovery point/time objectives, retention, and ownership. Do not describe a SQL-only archive as a complete school backup.

**Acceptance:** A restore drill recovers both records and representative documents; mismatches are detected; backup access and encryption are verified; retention and restoration timing are recorded.

### WB-10 — Vulnerable development dependency versions

**Evidence:** `npm audit --json` returned two high-severity package entries and exit code 1. Installed chain: `vite@8.3.1 -> postcss@8.5.28 -> source-map-js@1.2.1`; `@vitejs/plugin-react@6.1.1` shares that Vite installation.

| Package | Advisory evidence | Scope interpretation |
|---|---|---|
| source-map-js 1.2.1 | GHSA-68fv-2mgg-jv7q, indexed-source-map event-loop denial of service; audit affected range `<1.2.2` | Development/build dependency chain; an attacker-controlled source-map processing path was not found in the reviewed production API |
| Vite 8.3.1 | GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm; audit affected range 8.3.0–8.3.2 | Editor-launch argument/command issues, including Windows-specific cases; relevant to this Windows development workspace if prerequisites hold |

The application serves Vite middleware in development and static build output in production. Default local host binding is `127.0.0.1`. These are mitigating context, not reasons to retain vulnerable tooling. The audit contains **zero critical entries** and does not demonstrate that the production API is exploitable.

**Remediation:** Update Vite and the transitive source-map-js resolution to patched versions, commit the lockfile, rerun the audit/build/tests, and restrict access to development/editor endpoints. Verify compatibility before applying broad automatic dependency fixes.

**Acceptance:** A fresh locked install resolves outside all cited affected ranges; current audit and regression checks pass; development endpoints are not publicly exposed.

Advisory sources: [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [Windows percent escaping](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [editor argument interpretation](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [Windows existence check](https://github.com/advisories/GHSA-587h-7wmj-h5pm). Package descriptions and affected ranges above are recorded from the local audit response; applicability remains conditional.

### WB-11 — Orphaned document objects after database failure

**Evidence:** `server/routes.js:538` uploads the object before inserting `student_documents`, then audits separately. There is no compensating object deletion if the insert fails. Storage and SQL cannot share a normal database transaction.

**Impact:** Failed requests can retain private student document bytes with no corresponding metadata row or ordinary access path. An audit failure after successful insertion can also report an error even though the document exists. This is a consistency and retention issue rather than a demonstrated public disclosure.

**Remediation:** Delete the uploaded object on metadata-insertion failure; make metadata/audit changes transactional; add a periodic reconciliation process with safe age thresholds and retryable cleanup.

**Acceptance:** Injected insert failures leave no permanent orphan, audit failures produce consistent outcomes, and cleanup never deletes referenced objects.

## 5. Additional observations and design considerations

These are separate from the ranked findings and should not be mistaken for verified exploits.

- **Retention semantics:** `account-lifecycle.js` marks accounts closed and retains school records and email addresses. The README documents this. “Deletion” currently means access closure, not physical erasure. Define an actual retention/purge process and ensure product wording matches it; no legal noncompliance is asserted here.
- **Database transport configuration:** The example recommends `sslmode=verify-full`, and custom CA handling forces certificate verification. Validation also accepts `require` and `verify-ca`; the installed connection-string parser has weaker modes under libpq compatibility. Require explicit hostname-verifying settings in production and check the effective connection configuration. The current deployment was not inspected, so insecure TLS is not reported as confirmed.
- **RLS verification:** Schema initialization can enable RLS and revoke public/browser-role access. Vercel opens with `initialize:false`; deploy-time setup is therefore essential. Source code cannot prove that these protections have actually run on a deployed database or that the storage bucket remains private.
- **Request resource limits:** JSON is limited to 1 MB and documents to 4 MB, but uploads are buffered in memory and general authenticated/report routes do not have the auth router's rate limits. Synchronous `scryptSync` runs on the request event loop. Consider asynchronous password hashing, concurrency budgets, export limits, and gateway throttles following measured load tests.
- **Report/query scale:** Some exports and aggregates fetch whole result sets, and dashboards refresh alert data during GET requests. Evaluate large-school/large-platform performance and use pagination or streaming where necessary. No performance SLA failure was measured.
- **Origin checks:** Mutating API requests with Origin compare host rather than a configured full origin; malformed Origin values can become generic server errors. Authenticated writes additionally require a CSRF token and strict session cookies. Tighten canonical origin validation without breaking provider webhooks, which use separate authentication.
- **Worker observability:** `/healthz` checks SQL but not queue progress, SMTP, bucket readiness, or worker liveness. Record last successful job run, queue ages/failures, and alert on stalled delivery. Existing five-attempt retries and message claims are useful safeguards.
- **Test defaults:** `npm test` may skip database-dependent tests without `TEST_DATABASE_URL` or the embedded flag. CI should explicitly run `test:embedded` or an isolated PostgreSQL job and assert expected test/skip counts. Permission tests provide broad guard coverage but use policy-derived expected results, which cannot independently establish that the policy itself is correct.
- **Frontend performance:** The build succeeded but warned about a JavaScript chunk above 500 kB. The main output was approximately 510.79 kB / 150.13 kB gzip; logo and favicon assets were approximately 349.40 kB and 217.07 kB. Consider route splitting and smaller image variants for slower school/mobile connections.
- **Credential key separation:** Integration encryption and newsletter unsubscribe signatures share the integration key. Separate versioned keys would reduce rotation coupling and improve incident response. This is a hardening recommendation; no signature forgery was demonstrated.

## 6. Controls encountered that worked as intended

| Control | Evidence and practical limit |
|---|---|
| Password storage | Random salt with scrypt and timing-safe comparison. Synchronous processing remains a capacity concern. |
| Sessions | 32 random bytes, SHA-256 token storage, HttpOnly/SameSite strict cookies, Secure in production, eight-hour expiry. Logout and password reset delete sessions. |
| CSRF | Authenticated mutations compare `x-csrf-token` with the session token. Public bootstrap still needs separate authorization. |
| Brute-force throttling | PostgreSQL-backed atomic counters cover authentication IPs, account emails, and MFA accounts/IPs across app instances. Proxy configuration must match hosting. |
| Tenant/record access | `schoolRecord`, `studentAccess`, `classAccess`, academic helpers, and scoped SQL enforce many direct-object and relationship boundaries. Full owners intentionally cross tenants. |
| Role separation | Explicit permissions and platform designation distinguish school administrators from operators; platform support/subscription scopes add separation. |
| SQL injection resistance | Reviewed request values use placeholders. Dynamic table/column fragments are internal construction points and should remain restricted to trusted identifiers. No confirmed SQL injection was identified. |
| Integration encryption | AES-256-GCM, random IV, school/provider associated data, redacted read responses and audit values. This does not cover MFA secrets. |
| Payment integrity | Signed webhook checks, provider-side verification, reference/amount/currency/mode matching, row locks, idempotency, and review states for problematic settlement. No real money was moved. |
| Upload safety | Size limits, random keys, PDF/PNG/JPEG signature checks, private object retrieval after authorization, and attachment download. Signature checks do not constitute malware scanning. |
| Browser hardening | Helmet, production CSP, no-store API responses, and no obvious `dangerouslySetInnerHTML`, `eval`, or browser token-storage sinks found in the source search. Search results are not exhaustive XSS proof. |
| Exports | CSV escaping exists; Excel values are written as strings. Further spreadsheet-client edge cases were not exhaustively tested. |
| Notifications | Atomic delivery claims, bounded attempts, deduplication, and consent checks. SMTP still has an accepted-send/status-update crash window, as documented. |
| Historical integrity | Academic locks, finalized/published snapshots, revision history, transfer preservation, and restrictions on editing archived records are covered by existing tests. |

## 7. Validation evidence

Evidence artifacts are local diagnostics under ignored `test-results/` and should be retained separately if this report is shared:

| Artifact | Purpose |
|---|---|
| `whitebox-tests.log` | Existing embedded suite output |
| `whitebox-probes.mjs` | Reproducible isolated assessment probe; uses mock mail and fresh PGlite |
| `whitebox-probes.json` | Probe outcomes with no real credentials/secrets |
| `whitebox-npm-audit.json` | Raw dependency advisory response |
| `whitebox-build.log` | Production build output and size warning |

Confirmed probe output:

```json
{
  "unauthenticatedOwnerSetup": { "status": 201, "operators": 1 },
  "ownerMfaOptional": {
    "loginStatus": 200,
    "mfaRequired": false,
    "setupRequired": false
  },
  "mfaSecretStoredReadable": true,
  "sameTotpAcceptedAcrossSessions": [200, 200]
}
```

The probe's generated credentials are test-only and the database is destroyed on exit. The script must be run from this repository with dependencies installed; it does not load `.env` or open the application's `DATABASE_URL`.

**Build:** `npm run build` passed. Large-chunk warning recorded above.  
**Dependency audit:** completed with exit code 1 because two high-severity package entries were reported.  
**Embedded suite:** **119 tests passed, 0 failed, 0 skipped, 0 cancelled**; elapsed time approximately **242 seconds**. The launcher completed with exit code 0. Coverage included authentication, role guards, tenant isolation, academic/operations workflows, finance, integration encryption, payment availability, consent, notifications, account lifecycle, and Supabase configuration/storage adapters. These results validate the tested cases; they do not negate the findings above.

## 8. Remediation sequence

### Immediate containment and release gating

1. Determine whether committed database material contains sensitive information, who could access it, and whether it has been distributed. Secure the backups and stop committing operational data.
2. Close or protect both initial setup paths before exposing any fresh environment. Confirm that the intended owner exists on current deployments.
3. Update the affected development dependencies and validate their resolved versions.
4. Verify deployed database/browser-role protections, storage privacy, HTTPS, proxy settings, and worker liveness directly.

### Next engineering iteration

1. Encrypt MFA secrets, add atomic TOTP replay prevention, and design required MFA for privileged accounts.
2. Replace emailed passwords with single-use activation and define account recovery.
3. Restrict tenant SMTP egress and require transport security.
4. Move verification delivery out of locked transactions with a transactional outbox.
5. Add compensation/reconciliation for storage metadata failures.

### Operations and scale

1. Perform a full database-plus-documents restore drill and record recovery objectives.
2. Define retention/erasure behavior separately from account access closure.
3. Add worker/queue monitoring, explicit CI integration test requirements, and targeted load tests.
4. Optimize frontend delivery and large exports based on measured workloads.

Each finding should receive an owner, a target date, a linked implementation, and a retest result. Passing the current suite alone is insufficient: several weaknesses are intentional behaviors that existing tests accept, so remediation needs independently specified security acceptance tests.

## 9. Remediation validation addendum — 21 October 2026

The working tree now includes source fixes for WB-01 through WB-11 and removal of the newly discovered WB-12 build loader. See [the remediation matrix, deployment order, incident evidence and recovery procedure](SECURITY-HARDENING-2026-10-21.md). These are local changes; they have not been committed, pushed or applied to the live database/deployment.

Validation performed after the changes:

| Check | Result |
|---|---|
| Full embedded test suite | **125 passed; 0 failed, skipped or cancelled**, approximately 134 seconds |
| Upload/reconciliation locking follow-up | **22 targeted tests passed** after tightening serialization between upload completion and stale cleanup |
| Final security suite | **6 passed**, including production bootstrap/MFA/activation, legacy-secret migration/outbox retry, SMTP destination policy, encrypted backup recovery/tampering/no-overwrite, orphan reconciliation and upload-audit failure compensation |
| Browser authentication checks | Real-policy owner and school administrator MFA enrollment/unlock passed without page errors |
| Main browser workflow | Setup, verified login, MFA, class/admissions/fees/invoices/payments/enrollment, profile/document upload, attendance, staff check-in, export, navigation, integration credentials, mobile view and logout passed |
| Dependency audit | **0 vulnerabilities reported**; Vite 8.3.5 and source-map-js 1.2.2 |
| Builds after loader removal | Both ordinary production (`dist`) and Vercel (`public`) builds passed; large JavaScript chunk warning remains |
| Repository hygiene | **0 tracked files under data/backups**; 1,378 index removals prepared while preserving local database and eight local backup directories |
| Source scan | No remaining matches for the identified loader markers in application source, public/dist assets or installed JavaScript dependencies; source hygiene guard passed |

Diagnostics are in ignored `test-results/hardening-*.log`, `hardening-final-audit.json`, browser screenshots and the private incident-evidence directory. Other specialized legacy browser harnesses were not rerun. The check results do not establish the state of live RLS/storage configuration or host compromise.

**Still requires operational completion:** apply the hardening schema with the effective encryption key; deploy web/worker together; approve legitimate tenant SMTP hosts; configure the backup key and perform a real recovery drill; commit/publish the source/index changes through the normal release process; investigate the loader and historical database distribution, coordinate Git history cleanup where needed, and rotate potentially exposed credentials. These tasks remain explicitly open; source changes cannot retroactively revoke historical copies or prove that a historical loader did not execute.

**Subsequent publishing update:** The remaining 98 tracked diagnostic files and generated build output were untracked with local copies preserved. Local history has now been sanitized, including a historical private `.env` and an additional root `api.js` loader found on the remote branch. GitHub itself is unchanged. Deployment directly from this primary project root and the read-only deployment gate are documented in [the publication handoff](PUBLISH-READINESS-2026-10-21.md). After maintenance shutdown was confirmed, a verified encrypted backup was taken and the live schema/MFA migration completed. All 82 existing table counts were preserved and five MFA records were encrypted successfully; the live preflight now passes. Hosting release, coordinated worker deployment, incident credential work and remote GitHub cleanup remain outstanding. See the handoff for current recovery and release instructions.


**Root-project cleanup:** The user confirmed both hosted services are running. All 115 files in the redundant deployment ZIP matched the existing root exactly; the ZIP and duplicate packaging metadata were removed. The primary application and worker remain together in this root. No live services, database, keys, or deployment settings were changed by this cleanup.
