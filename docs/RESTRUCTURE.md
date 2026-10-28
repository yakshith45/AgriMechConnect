# Repository structure

This document describes the current code layout after consolidating the application at the repository root. It is an organizational map, not a claim that the planned cloud services or frontend redesign are implemented.

## Application boundaries

- `frontend/` contains static pages and browser assets. Pages are grouped by audience or purpose under `frontend/pages/`; shared CSS, images, and JavaScript live under `frontend/assets/`.
- `backend/` contains the Node.js/Express API. Route handlers, middleware, and configuration are separated; admin utilities, database migration runners, and tests have their own folders.
- `database/migrations/` contains the SQL change scripts used by the current PostgreSQL backend.
- `database/reference/` contains historical schema snapshots. These are retained for reference and should not be run as upgrades.
- `database/supabase/schema.sql`, `docs/SUPABASE_SETUP.md`, and `docs/CLOUDINARY_SETUP.md` are future integration notes. The current API still uses PostgreSQL through `pg`; no Cloudinary upload integration is present.
- `docs/` contains setup, workflow, and architecture documentation.

## Frontend page map

| Folder | Pages |
| --- | --- |
| `pages/public/` | About, contact |
| `pages/auth/` | Login, registration, location and role selection |
| `pages/farmer/` | Farmer dashboard, machinery search, bookings |
| `pages/owner/` | Owner dashboard, add machinery, booking requests |
| `pages/admin/` | Admin login and dashboard |

Shared browser utilities are in `assets/js/common/`. Page-specific scripts are grouped under `assets/js/pages/` using the same audience names.

## Follow-up work for the redesign

This pass reorganizes files and updates paths while retaining the existing page behavior and backend API. It does not split the large stylesheet, introduce a frontend framework, change database behavior, replace authentication, or configure cloud hosting. Those are separate redesign and launch-readiness tasks. Before deployment, choose a production hosting setup, review environment and security settings, and validate all page flows in the target hosting configuration.
