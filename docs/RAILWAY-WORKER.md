# Railway background worker

The web app runs on Vercel. Deploy a second Railway service from the same repository to run `server/jobs.js` continuously. The worker runs jobs immediately after startup and then once per minute. Do not configure a Vercel cron for the same jobs.

## Create the Railway service

1. In Railway, create a project and add a service from this GitHub repository.
2. Set the service root directory to the repository root.
3. Set the service's custom start command to:

   ```sh
   npm run worker
   ```

4. Use one replica. This worker is designed as a single service; notification claims and reminder dedupe keys also protect those operations from duplicate sends.
5. Set the restart policy to **On Failure**.
6. Do not expose a public domain or configure an HTTP health check for this worker.

Railway can install the project dependencies using the `package-lock.json`. The worker does not need a build command.

## Environment variables

Add the same values used by the Vercel app for the following variables:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL connection string. Use the Supabase transaction pooler and `sslmode=verify-full` (or the SSL configuration supported by your Supabase project). |
| `SUPABASE_URL` | HTTPS Supabase project origin. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key. Never use a browser/`VITE_` variable. |
| `SUPABASE_STORAGE_BUCKET` | The private document bucket name, normally `school-documents`. |
| `INTEGRATION_ENCRYPTION_KEY` | Must be exactly the same key as Vercel uses, so the worker can decrypt saved school integration settings. |
| `DB_POOL_MAX` | Set to `1` to limit the worker's database connections. |
| `DB_SSL_CA` | Set only if your database connection requires a custom trusted certificate. |
| `FEE_REMINDER_DAYS` | Optional. Defaults to `7,14,30`. |

Set `NODE_ENV=production` if desired; no HTTP port, `HOST`, `APP_URL`, `CRON_SECRET`, or Vercel-specific variables are required by the worker. Configure SMTP in Administration > Integrations (or supply the optional server email defaults described in the main README) for actual notification delivery.

Do not change the encryption key when copying the variables from Vercel. Changing it makes previously saved integration credentials unreadable.

## Before starting the worker

Run schema setup from a trusted environment before deploying schema changes:

```powershell
npm run supabase:setup
npm run supabase:check
```

The worker intentionally connects with schema initialization disabled. Check the Railway deploy logs for `SMPIS background worker started.` and `Background job run completed.`. On shutdown it handles Railway's `SIGTERM`, finishes the active run, and closes its database pool.

The existing notification delivery retries transient failures up to five attempts. SMTP still cannot guarantee exactly-once delivery if a process stops after a provider accepts a message but before the database records it as sent.
