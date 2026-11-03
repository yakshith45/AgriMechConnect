# Supabase PostgreSQL setup

The API connects to Supabase PostgreSQL through the Node `pg` driver. It keeps the current Express API, password hashing, JWT sessions, and business rules. For this setup, `DATABASE_URL` is the only Supabase credential the backend needs. The URL contains the PostgreSQL database password; a Supabase publishable/anon key or secret/service-role key is not needed because this app does not use the Supabase Data API or Supabase client library. Never put the database password or a secret/service-role key in frontend code.

## Create and prepare the database

1. Create a Supabase project and save its database password. Choose a region close to your application users.
2. Open **SQL Editor** in the Supabase Dashboard.
3. Open [`database/supabase/schema.sql`](../database/supabase/schema.sql), copy the complete file into a new SQL query, and run it once for a new project. It creates the tables and constraints used by the API, enables row-level security, and adds the tables to Supabase Realtime's publication. The API uses the database owner connection and applies authorization in Express.
4. In the dashboard, open **Connect** and copy a PostgreSQL URI. A direct connection URL has the form `postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres`; replace the placeholder with the database password you set for the project (not an API key). Percent-encode reserved characters in the password. Supabase direct database endpoints require IPv6 unless the project has IPv4 support enabled. If your network is IPv4-only, choose the **Session pooler** in Connect and paste its complete URI as shown; do not construct its hostname or username yourself. See [Supabase's connection options](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Configure the local backend

The repository includes a private local template at `backend/.env` and a shareable template at `backend/.env.example`. Fill in:

- `DATABASE_URL`: the complete Supabase direct or Session pooler URI, including the database password. Use Session pooler if your network cannot connect to the direct endpoint.
- `DATABASE_SSL=true`, `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, and `DATABASE_SSL_CA_PATH=ssl/prod-ca-2021.crt`. Save the database CA certificate downloaded from Supabase in `backend/ssl/prod-ca-2021.crt`; this local certificate folder is ignored by Git, so each deployment environment must receive the certificate separately.
- `JWT_SECRET`: a new random secret. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` and paste the output into the local `.env`.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`: values from the Cloudinary Console, required for machinery photo uploads.
- `FRONTEND_ORIGINS`: the exact local and production website origins allowed to call the API.

Keep `backend/.env` private. It is ignored by Git. Never put database credentials, JWT secrets, or the Cloudinary API secret in the frontend.

Install dependencies and start the API from the repository root:

```powershell
npm.cmd --prefix backend ci
npm.cmd start
```

Start the static frontend separately with its document root set to `frontend/`:

```powershell
Set-Location .\frontend
py -m http.server 5501
```

Open `http://localhost:5501/`. The API health endpoint at `http://localhost:5000/api/health` reports whether it can reach Supabase and whether the required core tables exist.

If startup or the health endpoint reports `ENOTFOUND` for the database host, DNS could not find that hostname; the request has not reached PostgreSQL, so this is not caused by a missing API key or a rejected password. Confirm the project is active and the project reference/host exactly matches the dashboard's **Connect** details. If the direct host still does not resolve on your network, copy the dashboard's Session pooler URI instead. See [Supabase DNS troubleshooting](https://supabase.com/kb/troubleshooting/nxdomain-error-connecting-to-a-supabase-project).

## Existing data and migrations

The schema file creates an empty database. It does not copy records from a previous local PostgreSQL database. If there is production data to preserve, export and import it into Supabase before switching the app to the new URL; validate table and sequence IDs before inviting users. Do not run historical full-schema snapshots under `database/reference/` as migrations.

For changes after the initial schema, SQL migrations live in `database/migrations/`. The matching backend migration commands use `DATABASE_URL` and apply the change to the configured Supabase database. For example, `npm.cmd --prefix backend run migrate:cloudinary` adds the Cloudinary public ID column to an existing database.

If the old database contains owner photos saved as base64 data URLs, first transfer those listing records to Supabase, then run `npm.cmd --prefix backend run migrate:cloudinary-images`. That command uploads those existing images to Cloudinary and replaces the data URL with its hosted URL and public ID. It stops on unsupported or oversized legacy images rather than deleting them.
