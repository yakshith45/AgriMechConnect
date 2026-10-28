# Future Supabase Migration Notes for AgriMechConnect

> **Not active in the current application.** The backend currently connects to PostgreSQL using `DB_*` variables and the Node `pg` package. This document is a draft for a possible hosted database migration; do not treat it as the current deployment procedure.

This guide walks you through setting up a free [Supabase](https://supabase.com/) project, running the database schema, and connecting the backend.

---

## 1. Create a Supabase Project

1. Go to [https://supabase.com/](https://supabase.com/) and click **Sign In** or **Start your project**.
2. Click **New Project**.
3. Fill in the project details:
   - **Name:** `AgriMechConnect`
   - **Database Password:** Choose a strong password and save it securely.
   - **Region:** Select `South Asia (Mumbai) [ap-south-1]` (closest for low latency in Karnataka/Sullia).
   - **Pricing Plan:** Free.
4. Click **Create new project** and wait 1–2 minutes for provisioning to finish.

---

## 2. Run the Schema in the Supabase SQL Editor

1. In your Supabase project dashboard, click on the **SQL Editor** tab (the `>_` icon on the left sidebar).
2. Click **New query**.
3. Open [database/supabase/schema.sql](../database/supabase/schema.sql).
4. Copy the entire content and paste it into the Supabase SQL Editor.
5. Click **Run** (or press `Ctrl+Enter`).
6. You should see `Success. No rows returned`.

Now click the **Table Editor** tab on the left sidebar: you will see all 8 tables ready:
- `users`
- `admin_accounts`
- `owner_access_requests`
- `admin_audit_logs`
- `machinery` (with `cloudinary_public_id` and `image_url`)
- `bookings`
- `conversations`
- `messages`

---

## 3. Retrieve Your Connection Settings

1. In Supabase, go to **Project Settings** (the gear icon on the left sidebar) -> **Database**.
2. Scroll to **Connection string**.
3. Select **URI** and choose **Transaction Pooler** (recommended for Node.js / serverless, port 6543):
   ```text
   postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   ```
4. Also go to **Project Settings** -> **API** to copy:
   - **Project URL:** `https://[PROJECT_REF].supabase.co`
   - **anon / public key:** `eyJhbGciOi...`
   - **service_role secret:** `eyJhbGciOi...`

---

## 4. Configure `backend/.env`

In your backend `.env` file, configure the connection:

```ini
PORT=5000
HOST=0.0.0.0

# Option A: Direct PostgreSQL / Supabase Pooler settings
DB_USER=postgres.[PROJECT_REF]
DB_HOST=aws-0-ap-south-1.pooler.supabase.com
DB_NAME=postgres
DB_PASSWORD=[YOUR_SUPABASE_DB_PASSWORD]
DB_PORT=6543

# Option B: Or use standard DATABASE_URL
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Supabase API (for Realtime & WebSockets)
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT & Frontend
JWT_SECRET=your_jwt_secret_key
FRONTEND_ORIGINS=http://127.0.0.1:5500,http://localhost:5500,http://localhost:3000
```
