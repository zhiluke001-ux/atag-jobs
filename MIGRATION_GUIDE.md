# ATAG Jobs — Supabase Migration and Deployment Guide

This guide assumes you are not deeply technical. Follow the order exactly. **Do not change the current production Railway service to Supabase until the migration checks and staging UAT pass.**

## 0. What this migration changes

First cutover architecture:

```text
Current React/Vite frontend
        |
        v
Railway Node/Express backend (one replica)
        |
        +--> Supabase PostgreSQL
        +--> Supabase Storage
```

The old Neon/PostgreSQL database is used as a **read-only migration source**. The migration script does not update it.

## 1. Values to obtain from your colleague

Ask your colleague for these values from the **same Supabase project**:

1. **Supabase Project URL** — looks like `https://<project-ref>.supabase.co`.
2. **Supabase database connection string** — for Railway use the **Session pooler** connection string on port `5432` if direct IPv6 connectivity is uncertain. For a local migration machine, Direct connection is fine when IPv6 works; otherwise use the Session pooler.
3. **Database password** — needed if the copied connection string contains `[YOUR-PASSWORD]` instead of an actual password.
4. **Supabase Secret API key** — preferably the current `sb_secret_...` backend key. A legacy `service_role` key is accepted by the code only as a fallback.

Do **not** ask for or put a Supabase secret key into the React/Vite frontend.

You also need your existing values that are not supplied by your colleague:

- Current old `DATABASE_URL`/Neon URL — this becomes `OLD_DATABASE_URL` on the migration machine only.
- Current `JWT_SECRET` (or choose and deliberately rotate it; see Security section).
- Existing VAPID public/private keys if push notifications must continue working.
- Existing password-reset email credentials (Gmail API or Resend), if used.
- Current production frontend URL/domain for `CORS_ORIGINS` and `PUBLIC_APP_URL`.

## 2. Where your colleague finds the Supabase values

### Project URL and Secret key

1. Open the Supabase project.
2. Open **Settings**.
3. Open **API Keys**.
4. Copy the Project URL from the project/connect information if needed.
5. Under current API keys, copy a **Secret key** beginning with `sb_secret_...`.
6. Do not send/store the secret in the frontend or commit it to Git.

### Database connection string

1. Open the Supabase project dashboard.
2. Click **Connect** at the top of the project.
3. Select the connection type.
4. For the Railway backend, copy **Session pooler** (port `5432`) unless you know Railway can use the project’s direct IPv6 endpoint.
5. For a future Vercel/serverless backend, use a **transaction pooler** connection string (port `6543`) instead.
6. If the string shows `[YOUR-PASSWORD]`, replace it with the project database password.

## 3. Do not touch production yet

Before running migration:

1. Download/extract this project ZIP to your computer.
2. Keep the existing production Railway service unchanged.
3. Copy the current Railway variables somewhere secure so you can compare them later.
4. Do not delete the old Neon database.
5. Do not delete legacy blobs from the old DB.

## 4. Prepare the migration machine

Install **Node.js 20** and npm.

Open Terminal / PowerShell in the extracted project:

```bash
cd server
npm ci
```

Expected result: npm completes without dependency errors.

Create the migration environment file:

### Windows PowerShell

```powershell
Copy-Item .env.migration.example .env.migration
notepad .env.migration
```

### macOS/Linux

```bash
cp .env.migration.example .env.migration
```

Fill in:

```text
OLD_DATABASE_URL=<CURRENT OLD NEON/RAILWAY POSTGRES URL>
DATABASE_URL=<NEW SUPABASE POSTGRES CONNECTION STRING>
SUPABASE_URL=<NEW SUPABASE PROJECT URL>
SUPABASE_SECRET_KEY=<NEW sb_secret_... KEY>
PGSSL=require
IMAGE_MAX_BYTES=5242880
```

Important checks before saving:

- `OLD_DATABASE_URL` and `DATABASE_URL` must be different.
- The old URL must point to the database that contains `kv.k='db'`.
- The new URL must point to your colleague’s Supabase database.
- Never commit `.env.migration`.

## 5. Run the legacy migration

From `server/` run:

```bash
npm run migrate:legacy:env
```

The script will:

1. Read the old `kv` row only.
2. Validate legacy data before importing.
3. Create the normalized tables in Supabase.
4. Create/check Storage buckets:
   - `avatars` — public
   - `verification-photos` — private
   - `parking-receipts` — private
5. Upload referenced Base64 blobs with deterministic paths.
6. Migrate users/jobs/applications/statuses/attendance/loading/early-call/adjustments/full-timers/notifications/push subscriptions/audit/receipts.
7. Store a migration run record and summary.

Expected successful ending resembles:

```text
=== Migration summary ===
Users migrated: X
Jobs migrated: X
Applications migrated: X
Attendance records migrated: X
Notifications migrated: X
Parking receipts migrated: X
Files migrated: X
Files reused: X
Files failed: 0
Destination counts: ...
```

**Do not continue to production if `Files failed` is greater than 0 or the process exits with an error.**

### If validation fails

The script stops before importing operational data when it finds blocking source problems such as duplicate IDs/emails/usernames, malformed job times or references to missing users.

Copy the validation output and fix the migration logic/source issue deliberately. Do not edit the old database merely to make the script pass.

### If a file upload fails

The migration exits non-zero and records the problem. Successfully migrated legacy blobs are checkpointed in `legacy_blob_migrations`. Fix the credential/network/file issue and rerun **before production cutover**. Already checkpointed blobs are reused instead of uploaded again.

### If you see `/uploads/...` in a file failure

That image is not present inside the PostgreSQL `kv` Base64 blob store and therefore cannot be reconstructed from the old database alone. Recover that exact file from the old server/deployment backup if available, upload it to the correct bucket, update the destination path deliberately, and rerun/verify. Do not silently drop it.

## 6. Verify the migrated database

In Supabase:

1. Open **SQL Editor**.
2. Open `VERIFICATION.sql` from this project.
3. Paste it into a new query.
4. Run it.

Check especially:

- user count
- job count
- application total and status breakdown
- attendance total
- notifications
- audit logs
- parking receipts
- migrated file checkpoints
- actual Storage object counts
- latest `migration_runs.status`
- database size

Broken-reference queries should return `0`.

Compare the numbers with the migration summary and your expected production data.

## 7. Prepare a new Railway staging backend

Prefer a **new Railway service** for the refactored backend instead of overwriting the currently running service immediately.

1. Push this code to a GitHub repository owned by the eventual project owner/team.
2. In Railway, create/connect a new service from the repository.
3. Set the service root directory to `server` if Railway is connected to the monorepo root.
4. Ensure the start command is `npm start` / `node server.js`.
5. Keep replicas at **1** for initial cutover/UAT.
6. In the Railway service, open **Variables**.
7. Add variables individually or use **Raw Editor**.

Minimum staging variables:

```text
NODE_ENV=production
DATABASE_URL=<SUPABASE SESSION POOLER URL>
JWT_SECRET=<STRONG SECRET>
CORS_ORIGINS=<STAGING FRONTEND ORIGIN>
PUBLIC_APP_URL=<STAGING FRONTEND URL>
SUPABASE_URL=<SUPABASE PROJECT URL>
SUPABASE_SECRET_KEY=<sb_secret_...>
PGSSL=require
```

For existing features also copy/configure:

```text
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER=
```

or the Resend alternative:

```text
RESEND_API_KEY=
FROM_EMAIL=
```

7. Deploy the staging service.
8. In Railway Settings, configure health check path:

```text
/health
```

Expected:

```json
{
  "ok": true,
  "database": "ok"
}
```

A backend boot must not create or rewrite production data.

## 8. Point a staging frontend to the new backend

For the React/Vite frontend, only set:

```text
VITE_API_BASE=https://<new-staging-backend-domain>
```

Do **not** add any `SUPABASE_SECRET_KEY`, `service_role`, database URL, or DB password to Vite variables. Any `VITE_...` value is compiled into browser JavaScript and should be considered public.

Rebuild/redeploy the frontend after changing `VITE_API_BASE`.

## 9. Run UAT

Open `UAT_CHECKLIST.md` and complete every checkbox.

The highest-risk tests are:

- double-click approval
- two concurrent approvals for the last slot
- idempotency replay
- no duplicate approval notification
- deadline bypass attempt via direct API call
- private receipt/photo access
- invalid push subscription cleanup
- backend restart persistence
- controlled database write failure
- streamed CSV export

Do not cut over production with unresolved failures in these areas.

## 10. Production cutover

Only after staging passes:

1. Freeze admin/PM changes briefly so data does not change in old production while you take the final migration snapshot.
2. Run `npm run migrate:legacy:env` one final time against the latest old `kv` source **before any writes occur in the new production system**.
3. Re-run `VERIFICATION.sql`.
4. Confirm `Files failed: 0` and latest migration status is `completed`.
5. Set production Railway backend variables to the Supabase values.
6. Keep production backend replica count at 1 initially.
7. Deploy the refactored backend.
8. Confirm `/health` is 200.
9. Point the production frontend’s `VITE_API_BASE` at the refactored Railway backend and redeploy the frontend.
10. Run a short production smoke test: login, jobs list, apply, approve a test/known record if appropriate, notification, file view.
11. End the change freeze.

After users begin writing to Supabase, **do not rerun the legacy importer**, because it is designed for pre-cutover import/retry and can overwrite normalized records with the older snapshot.

## 11. Rollback plan

### Before frontend cutover

No rollback is needed: the existing production service remains untouched. Fix staging and repeat verification.

### Immediately after first cutover

The safest rollback is to change the frontend API base back to the previous Railway service **only as a short emergency measure**, because the old Neon database is already at its size limit and the legacy backend can crash on writes.

Do not treat the old stack as a stable long-term rollback target.

If the issue is only in the newly deployed code but the Supabase data is good, prefer rolling Railway back to the previously tested refactored deployment while **keeping Supabase as the database**. Do not point normalized code at the old `kv` database; the schemas are incompatible.

### After Supabase receives production writes

Do not run the legacy importer again. Use Supabase backup/PITR/database backup facilities appropriate to the project plan and roll back application code independently.

## 12. Environment variable placement

### Local migration machine

Required:

```text
OLD_DATABASE_URL
DATABASE_URL
SUPABASE_URL
SUPABASE_SECRET_KEY
PGSSL=require
```

### Railway staging backend

```text
NODE_ENV=production
DATABASE_URL
JWT_SECRET
CORS_ORIGINS
PUBLIC_APP_URL
SUPABASE_URL
SUPABASE_SECRET_KEY
PGSSL=require
VAPID_PUBLIC_KEY          # if push enabled
VAPID_PRIVATE_KEY         # if push enabled
VAPID_SUBJECT             # if push enabled
Gmail/Resend variables    # if password reset email enabled
```

### Railway production backend

Same variable names as staging, but use the production frontend origin/domain and production secrets.

### React/Vite frontend

```text
VITE_API_BASE
```

Nothing else is required for Supabase. In particular, **never put the Supabase secret key or database URL into a `VITE_` variable**.

### Future Vercel backend

When/if the Express API is converted for Vercel/serverless execution:

```text
DATABASE_URL=<Supabase transaction pooler, normally port 6543>
JWT_SECRET
CORS_ORIGINS
PUBLIC_APP_URL
SUPABASE_URL
SUPABASE_SECRET_KEY
VAPID/email variables as required
```

Before that move, rerun the full UAT under serverless execution. The first migration deliberately keeps the backend on Railway.

## 13. Security and secret rotation

The uploaded ZIP did not contain `server/db.json` or an obvious literal production database URL/API secret in the source tree that was inspected. The final handover ignores production data exports and environment files.

Still rotate a credential if you know it was historically committed to Git or shared insecurely:

- old/new database password
- `JWT_SECRET`
- Supabase secret/service-role key
- VAPID private key
- Gmail OAuth client secret/refresh token
- Resend API key

If you rotate `JWT_SECRET`, all existing ATAG login tokens become invalid and users must log in again. That is expected.

## 14. Final owner handover

The colleague/team owner should ultimately control:

- GitHub repository
- Supabase project/billing
- Railway or future Vercel project
- frontend Vercel project when moved
- domain and DNS
- production environment variables/secrets
- email/push credentials

There are no account IDs hard-coded into the refactored persistence/storage layer.
