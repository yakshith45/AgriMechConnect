# AgriMechConnect

AgriMechConnect is a local agricultural machinery rental marketplace. Farmers can discover equipment and request bookings; machinery owners can publish listings and manage requests. The application currently has a static HTML/CSS/JavaScript frontend, a Node.js/Express API, and a PostgreSQL database.

## Repository layout

```text
AgriMechConnect/
├── backend/
│   ├── config/                 # Database and service-area configuration
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
│   ├── migrations/             # Additive PostgreSQL SQL migrations
│   ├── reference/              # Historical schema snapshots; inspect before use
│   └── supabase/               # Proposed Supabase schema, not active backend config
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

1. Install a supported Node.js release and PostgreSQL.
2. Copy `backend/.env.example` to `backend/.env` and set the local PostgreSQL credentials and a strong `JWT_SECRET`.
3. From the repository root, install backend dependencies with `npm --prefix backend install`.
4. Start the API with `npm start` (or `npm run dev` while developing).
5. Serve the `frontend/` directory over HTTP using a static development server. The frontend and API run separately; the API listens on port 5000 by default.

The frontend uses root-relative `/assets/...` and `/pages/...` paths, so configure the static server's document root as `frontend/`. Opening HTML files directly with `file://` is unsupported.

## Database notes

The active backend connects to PostgreSQL using `DB_*` variables. SQL files in `database/migrations/` are applied by the matching `npm --prefix backend run migrate:<name>` commands. Historical schema snapshots are kept under `database/reference/`; they are not migration instructions. Supabase and Cloudinary files describe possible future integrations and are not wired into the current application.
