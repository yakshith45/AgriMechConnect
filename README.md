# AgriMechConnect

AgriMechConnect is an agricultural machinery rental marketplace. Farmers can discover equipment and request bookings; machinery owners can publish listings and manage requests. The application has a static HTML/CSS/JavaScript frontend, a Node.js/Express API, Supabase-hosted PostgreSQL, and Cloudinary-hosted owner photos.

## Repository layout

```text
AgriMechConnect/
├── backend/
│   ├── config/                 # Supabase PostgreSQL, Cloudinary, and service-area clients
│   ├── middleware/             # Authentication and authorization
│   ├── routes/                 # Express API route handlers
│   ├── scripts/
│   │   ├── admin/              # Admin provisioning and account-role tools
│   │   └── database/           # PostgreSQL migration runners
│   ├── tests/                  # Backend tests, grouped by route or utility
│   ├── server.js               # Express API entry point
│   ├── package.json
│   └── .env.example
├── database/
│   ├── migrations/             # PostgreSQL SQL migrations
│   ├── reference/              # Historical schema snapshots; inspect before use
│   └── supabase/               # Canonical Supabase schema
├── docs/                       # Setup, workflow, and architecture notes
├── frontend/
│   ├── assets/
│   │   ├── css/                # Site stylesheets
│   │   ├── images/             # Logos, icons, and machinery photography
│   │   └── js/
│   │       ├── common/         # Shared API, auth, and map configuration
│   │       └── pages/          # Page-specific browser scripts
│   ├── pages/
│   │   ├── admin/
│   │   ├── auth/
│   │   ├── farmer/
│   │   ├── owner/
│   │   └── public/
│   └── index.html              # Public landing page
├── .gitignore
└── package.json                # Convenience scripts for the backend
```

## Local development

1. Install a supported Node.js release.
2. Fill in `backend/.env` with the full Supabase PostgreSQL URL (including its database password), a strong `JWT_SECRET`, and the Cloudinary credentials. This backend uses PostgreSQL directly, so it does not need a Supabase API key. See [Supabase setup](docs/SUPABASE_SETUP.md) for direct versus Session pooler connections.
3. From the repository root, install backend dependencies with `npm --prefix backend ci`.
4. Start the API with `npm start` (or `npm run dev` while developing).
5. Serve the `frontend/` directory over HTTP using a static development server. The frontend and API run separately; the API listens on port 5000 by default.

The frontend uses root-relative `/assets/...` and `/pages/...` paths, so configure the static server's document root as `frontend/`. Opening HTML files directly with `file://` is unsupported.

## Database notes

The backend connects to Supabase PostgreSQL using `DATABASE_URL`. Set up a new project with `database/supabase/schema.sql`. SQL changes after setup are in `database/migrations/` and can be applied using the matching `npm --prefix backend run migrate:<name>` commands. Owner photos upload through the API to Cloudinary; only their hosted URL and public ID are saved in the database. Historical schema snapshots under `database/reference/` are not migration instructions.
