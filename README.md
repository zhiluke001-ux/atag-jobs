# ATAG Jobs — Supabase-ready refactor

This handover removes the legacy whole-application `kv` JSONB persistence model. The production API now reads/writes normal PostgreSQL rows and stores images in Supabase Storage.

## Architecture for first production cutover

```text
Existing React/Vite frontend
        |
        v
Railway Node/Express backend (one replica initially)
        |
        +--> Supabase PostgreSQL
        +--> Supabase Storage
```

Do **not** move the backend to Vercel Functions until UAT confirms all routes are stateless/serverless-safe. The code no longer relies on application-server persistence, but Railway-first cutover keeps the infrastructure change smaller.

## Important files

- `server/db/schema.sql` — normalized database schema.
- `server/scripts/migrate-schema.js` — apply schema to a new database.
- `server/scripts/migrate-legacy.js` — read old `kv.k='db'`, validate and migrate to Supabase.
- `server/repository.js` — relational read/assembly layer.
- `server/storage.js` — server-side Supabase Storage access.
- `server/lib/errors.js` — async/error mapping including PostgreSQL `53100`.
- `MIGRATION_GUIDE.md` — exact migration/cutover/rollback steps.
- `VERIFICATION.sql` — post-migration SQL checks.
- `UAT_CHECKLIST.md` — final functional/concurrency checklist.
- `server/.env.example` — backend variables.
- `server/.env.migration.example` — one-time migration variables.
- `web/.env.example` — frontend variable; no Supabase secret is used in the browser.

## Local static checks

```bash
cd server
npm ci
npm run check

cd ../web
npm ci
npm run build
```

The migration needs live old/new database connections and Supabase Storage credentials, so it cannot be completed by code-only static checks.
