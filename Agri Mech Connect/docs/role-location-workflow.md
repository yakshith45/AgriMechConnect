# Role and location workflow

## Safe database migrations

From `Agri Mech Connect\backend`, apply the additive migrations:

```powershell
npm.cmd run migrate:role-location
npm.cmd run migrate:marketplace
npm.cmd run migrate:booking-availability
npm.cmd run migrate:admin
```

The migrations add role permissions and saved coordinates, machinery marketplace details and owner-entered availability windows, booking rental-rate snapshots, and the separate Admin Dashboard tables and moderation flags. They use the existing `backend/.env` connection settings without printing them, preserve existing records, and are safe to re-run. Existing listings receive the default `day` pricing unit and empty specifications; existing bookings receive a backfilled rate snapshot. The Admin migration adds an Admin-only `admin_accounts` store, owner access request and audit tables, plus `users.is_suspended` and `machinery.admin_active`; it does not create an Admin user or grant Owner access.

Do not run `database/schema.sql` to apply this update: that older setup script contains `DROP TABLE` statements. The dedicated migration above is the non-destructive update path.

Existing accounts are not automatically granted both roles. An authorized administrator with access to the backend deployment can use the operator-only account-role command:

```powershell
Set-Location -LiteralPath "C:\Users\ajsul\Downloads\Agri Mech Connect  3\Agri Mech Connect\backend"
npm.cmd run account:roles
```

Choose **Farmer and Owner**, enter the existing account email, and confirm with `YES`. The command uses the configured PostgreSQL credentials, updates only that account's role permissions in a transaction, and does not modify passwords, bookings, or machinery. Do not expose the backend database credentials or command access to users. The app does not provide a self-service or public Owner-grant endpoint; registration only grants Farmer access. After an administrator changes access, sign out and sign in again so the login response contains the refreshed permissions. Login opens a single-role account's permitted dashboard directly. A dual-role account is offered Farmer and Machinery Owner choices; the backend checks the requested role against `allowed_roles` before issuing an active role token. Every protected request continues to verify the active role against the database.

## Admin dashboard and Owner approvals

The Admin Dashboard uses a separate `admin_accounts` table and Admin JWT type; regular registration cannot create an Admin account. After applying the migrations above, provision the first administrator from an interactive backend terminal. The command prompts for a name and email and reads the password twice without echoing it. Use a unique, strong password of at least 12 characters:

```powershell
Set-Location -LiteralPath "C:\Users\ajsul\Downloads\Agri Mech Connect  3\Agri Mech Connect\backend"
npm.cmd run admin:provision
```

For local development, you can instead provide credentials through temporary environment variables. This command refuses to run unless `NODE_ENV=development` and the configured PostgreSQL host is loopback (`localhost`, `127.0.0.1`, or `::1`). It creates a new account only, hashes the password with bcrypt, and refuses to modify an existing Admin account:

```powershell
Set-Location -LiteralPath "C:\Users\ajsul\Downloads\Agri Mech Connect  3\Agri Mech Connect\backend"
$previousNodeEnv = $env:NODE_ENV
$env:NODE_ENV = "development"
$env:ADMIN_BOOTSTRAP_NAME = Read-Host "Admin display name"
$env:ADMIN_BOOTSTRAP_EMAIL = Read-Host "Admin email"
$secureAdminPassword = Read-Host "New Admin password (minimum 12 characters)" -AsSecureString
$env:ADMIN_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new("", $secureAdminPassword).Password
try {
    npm.cmd run admin:provision:env
} finally {
    Remove-Item Env:ADMIN_BOOTSTRAP_NAME, Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    if ($null -eq $previousNodeEnv) {
        Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    } else {
        $env:NODE_ENV = $previousNodeEnv
    }
    $secureAdminPassword.Dispose()
}
```

The password is entered at a hidden prompt rather than typed into the command line or saved in shell history. Do not put Admin credentials in `.env`, source files, or command-line arguments. If provisioning reports that the email already exists, use the existing account's password or follow the project's password recovery procedure; this command never resets an existing password.

The Admin dashboard and APIs remain protected by Admin authentication. The private Admin sign-in page is available directly at `http://localhost:5501/admin-login.html` and is not linked from public site navigation. A logged-in Farmer can request Owner access from the role-and-location page; the request is saved against that same account and does not grant access. An Admin reviews pending requests under **Owner approvals** and approves or rejects them. Approval adds `owner` to that existing user's `allowed_roles`; the account keeps its Farmer access, email, password, bookings, and machinery. Rejection preserves Farmer access. A partial unique database index and server-side upsert prevent multiple pending requests for the same user. Approval, rejection, role changes, account status changes, machinery moderation, and Admin booking cancellations are audited. After approval, the user must log out and back in; login reads the updated permissions from PostgreSQL before issuing a role-selection token.

The Admin dashboard's **Users** section supports search/filter, role grants/revocation, account suspension, and user detail inspection. **Machinery** can deactivate/reactivate listings without changing the owner's own availability. **Bookings** provides read-only inspection and reason-required cancellation for pending or accepted bookings; other status transitions remain governed by normal booking rules. Admin actions require an active Admin JWT and are checked against the database on every API request. Logout increments the Admin token version in PostgreSQL, invalidating the bearer token server-side as well as clearing it in the browser.

## Run the application

Apply the migration once, then start the API in one PowerShell terminal from the project root:

```powershell
Set-Location -LiteralPath "C:\Users\ajsul\Downloads\Agri Mech Connect  3\Agri Mech Connect"
npm.cmd start
```

The root start script delegates to `backend\package.json` and runs `node server.js` from the backend directory. To start it directly instead, change to `backend` and run `npm.cmd start`.

Start the frontend in a second PowerShell terminal:

```powershell
Set-Location -LiteralPath "C:\Users\ajsul\Downloads\Agri Mech Connect  3\Agri Mech Connect\frontend"
py -m http.server 5501
```

Open `http://localhost:5501/login.html`. Port 5500 was already occupied by another local listener during verification. A single-role account goes directly to its dashboard after login. If the account has both roles, choose the Farmer or Machinery Owner button; the server authorizes the role before directing to the dashboard. If that role has no saved location in the service area, the existing location picker collects and saves the selection before continuing. The backend defaults to the Sullia center `(12.561, 75.387)` and a 25 km radius; `SULLIA_CENTER_LATITUDE`, `SULLIA_CENTER_LONGITUDE`, and `FARM_LOCATION_RADIUS_KM` may be set in `backend/.env`.

Keep the backend running in its terminal while using the site. The frontend must be served over HTTP; opening an HTML file directly with `file://` is not supported. All frontend API calls use `frontend/api.js`, which targets port 5000 on the hostname used by the browser (so `localhost` and `127.0.0.1` stay consistent). Local HTTP origins on loopback are allowed for development. For a non-loopback frontend host, list its full origin in the comma-separated `FRONTEND_ORIGINS` value in `backend/.env`.

The server uses port 5000 and validates required database and JWT environment variables without printing their values. A temporary PostgreSQL outage leaves the HTTP server running; check `http://localhost:5000/api/health` for separate server/database status and any missing required tables. Apply the documented additive migrations when the health response reports an incomplete schema.

For the farmer marketplace, confirm a Farmer role and saved location, then open `dashboard.html`. The 5/10/25 km radius, machinery category, tractor horsepower, sprayer 25-litre, price, and requested date/time filters use real owner listings and server-calculated distance/availability. Booking requests are persisted as Pending with the server-calculated rental-rate snapshot. The displayed total is an estimate; minimum rental periods, transport, and other fees are not configured. Owners respond from `booking-requests.html`; farmers can cancel pending or accepted bookings for six hours after creation, with the server enforcing the deadline. Owners can add, edit, and mark their own listings unavailable at `add-machinery.html`. Uploaded owner photos are shown when present; category-specific visual placeholders cover missing or broken photos.

The location page uses Leaflet, OpenStreetMap.de raster tiles, and Photon search. OpenStreetMap.de is used because the standard OpenStreetMap tile host may deny requests from some networks; map data and tile-provider attribution are displayed on the map. It debounces searches, spaces Photon requests to at least 1.1 seconds, and filters real results to the configured service area. Village search depends on OpenStreetMap data coverage and does not fabricate missing results. The OpenStreetMap option works without a key. To enable the optional Google map, set a browser-restricted Google Maps JavaScript API key in `frontend/map-config.js`; restrict it to the local/deployed site origins and the Maps JavaScript API. This browser key is public configuration, not a backend secret.

## Checks

In the backend terminal:

```powershell
npm.cmd test
```

The suite covers role/location and marketplace workflows, separate Admin login and authorization, interactive Admin provisioning hash validation, Owner access requests and approval/rejection boundaries, and booking/availability protections. The Admin migration and first Admin provisioning are operator actions and are not performed by the test suite.

To syntax-check the browser scripts from the project root:

```powershell
Get-ChildItem .\frontend -Filter *.js -Recurse | ForEach-Object { node --check $_.FullName }
```

In another terminal, confirm the server responds:

```powershell
Invoke-RestMethod -Uri "http://localhost:5000/health"
```

`/health` remains available for compatibility; new checks should use `/api/health`.

Use the login page to exercise direct Farmer login and direct Owner login. For a dual-role account, verify both dashboard choices, then use a Farmer-only account to confirm an Owner request is rejected. Grant Owner access only through the operator flow above, then log out and back in before trying Owner access. To test location, clear or update the account's saved location and confirm login routes through location search or map-pin confirmation before opening the selected dashboard. The browser must grant location permission for the current-location button; searching and manual pin placement do not require it.
