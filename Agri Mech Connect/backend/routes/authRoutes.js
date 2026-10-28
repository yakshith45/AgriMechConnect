const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const pool = require("../config/db");
const { authenticateSelectionSession } = require("../middleware/authMiddleware");
const {
    SULLIA_CENTER,
    LOCATION_RADIUS_KM,
    isWithinLocationRadius
} = require("../config/location");

const router = express.Router();

function hasConfirmedLocation(user) {
    const latitude = user.selected_latitude ?? user.farm_latitude;
    const longitude = user.selected_longitude ?? user.farm_longitude;
    const location = user.selected_location || user.farm_location;
    return typeof location === "string" && location.trim().length > 0 &&
        Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
        latitude >= -90 && latitude <= 90 &&
        longitude >= -180 && longitude <= 180 &&
        isWithinLocationRadius(Number(latitude), Number(longitude));
}

function createRoleSelectionToken(user) {
    const roles = Array.isArray(user.allowed_roles) && user.allowed_roles.length
        ? user.allowed_roles
        : [user.role];
    return jwt.sign(
        {
            id: user.id,
            name: user.name,
            role: user.role,
            locationConfirmed: hasConfirmedLocation(user),
            permittedRoles: roles
        },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );
}

function createActiveRoleToken(user) {
    const roles = Array.isArray(user.allowed_roles) && user.allowed_roles.length
        ? user.allowed_roles
        : [user.role];
    return jwt.sign(
        {
            id: user.id,
            name: user.name,
            role: user.role,
            locationConfirmed: true,
            permittedRoles: roles
        },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );
}

function publicSessionUser(user) {
    const roles = Array.isArray(user.allowed_roles) && user.allowed_roles.length
        ? user.allowed_roles
        : [user.role];
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permitted_roles: roles,
        allowed_roles: roles,
        selected_location: user.selected_location || user.farm_location,
        selected_latitude: user.selected_latitude ?? user.farm_latitude,
        selected_longitude: user.selected_longitude ?? user.farm_longitude,
        farm_location: user.farm_location,
        farm_latitude: user.farm_latitude,
        farm_longitude: user.farm_longitude
    };
}

function isDatabaseUnavailable(error) {
    if (!error || typeof error !== "object") return false;
    const code = error.code;
    return [
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "57P01",
        "57P02",
        "57P03"
    ].includes(code) ||
        (typeof code === "string" && code.startsWith("08"));
}

function databaseFailureMessage(error) {
    if (!error || typeof error !== "object") return null;
    if (["28P01", "3D000"].includes(error.code)) {
        return "PostgreSQL rejected the configured credentials or database name. Verify DB_* settings in backend/.env.";
    }
    if (error.code === "42P01") {
        return "PostgreSQL is missing required application tables. Run the documented database migrations.";
    }
    if (isDatabaseUnavailable(error)) {
        return "PostgreSQL is unavailable. Start the database and verify DB_* settings in backend/.env.";
    }
    return null;
}

function logAuthenticationFailure(operation, error) {
    const code = typeof error?.code === "string" ? error.code : "unknown";
    const databaseMessage = databaseFailureMessage(error);
    const isPostgresError = /^[0-9A-Z]{5}$/.test(code);
    console.error(`${operation} failed:`, {
        category: databaseMessage || isPostgresError || isDatabaseUnavailable(error)
            ? "database"
            : "application",
        code,
        message: databaseMessage ||
            (isPostgresError ? "PostgreSQL rejected the authentication request." : "Authentication request failed.")
    });
}

// REGISTER
router.post("/register", async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password,
            role: requestedRole,
            farmLocation,
            farmLatitude,
            farmLongitude
        } = req.body || {};

        const normalizedRole = typeof requestedRole === "string" ? requestedRole.trim().toLowerCase() : "";
        if (!["farmer", "owner"].includes(normalizedRole)) {
            return res.status(400).json({
                message: "Please choose an account role: Farmer or Machinery Owner."
            });
        }
        const role = normalizedRole;
        const normalizedName = typeof name === "string" ? name.trim() : "";
        const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
        const normalizedPhone = typeof phone === "string" ? phone.trim() : "";

        if (!normalizedName || !normalizedEmail || !normalizedPhone || typeof password !== "string" || !password) {
            return res.status(400).json({ message: "Please fill all required fields" });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ message: "Enter a valid email address" });
        }

        const compactPhone = normalizedPhone.replace(/[\s()-]/g, "");
        if (!/^(?:\+?91)?[6-9]\d{9}$/.test(compactPhone)) {
            return res.status(400).json({ message: "Enter a valid 10-digit Indian mobile number" });
        }

        if (!process.env.JWT_SECRET) {
            return res.status(503).json({
                message: "Registration is unavailable because JWT_SECRET is not configured in backend/.env."
            });
        }

        const hasFarmLocation = farmLocation != null ||
            farmLatitude != null ||
            farmLongitude != null;
        if (hasFarmLocation) {
            if (
                typeof farmLocation !== "string" ||
                !farmLocation.trim() ||
                typeof farmLatitude !== "number" ||
                typeof farmLongitude !== "number" ||
                !Number.isFinite(farmLatitude) ||
                !Number.isFinite(farmLongitude) ||
                farmLatitude < -90 ||
                farmLatitude > 90 ||
                farmLongitude < -180 ||
                farmLongitude > 180
            ) {
                return res.status(400).json({
                    message: "Select a valid farm location and coordinates on the map"
                });
            }

            if (!isWithinLocationRadius(farmLatitude, farmLongitude)) {
                return res.status(400).json({
                    message: `Farm location must be within ${LOCATION_RADIUS_KM} km of Sullia, Karnataka`
                });
            }
        }

        const existingUser = await pool.query("SELECT * FROM users WHERE LOWER(email) = $1", [normalizedEmail]);

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ message: "Email already registered" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (
                name, email, phone, password, role,
                allowed_roles, farm_location, farm_latitude, farm_longitude,
                selected_location, selected_latitude, selected_longitude
             )
             VALUES ($1, $2, $3, $4, $5, ARRAY[$5]::TEXT[], $6, $7, $8, $6, $7, $8)
             RETURNING id, name, email, phone, role,
                       allowed_roles, farm_location, farm_latitude, farm_longitude,
                       selected_location, selected_latitude, selected_longitude`,
            [
                normalizedName,
                normalizedEmail,
                normalizedPhone,
                hashedPassword,
                role,
                hasFarmLocation ? farmLocation.trim() : null,
                hasFarmLocation ? farmLatitude : null,
                hasFarmLocation ? farmLongitude : null
            ]
        );

        const user = result.rows[0];
        const token = createActiveRoleToken(user);

        res.status(201).json({
            message: "Registration successful",
            token,
            user: publicSessionUser(user)
        });
    } catch (error) {
        logAuthenticationFailure("Registration", error);
        if (error.code === "23505") {
            return res.status(409).json({ message: "Email already registered" });
        }
        const databaseMessage = databaseFailureMessage(error);
        if (databaseMessage) {
            return res.status(503).json({ message: databaseMessage });
        }
        res.status(500).json({ message: "Server error" });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    try {
        const body = req.body || {};
        const email = typeof body.email === "string"
            ? body.email.trim().toLowerCase()
            : "";
        const { password } = body;
        if (!email || typeof password !== "string" || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }

        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const user = result.rows[0];
        if (user.is_suspended) {
            return res.status(403).json({ message: "This account is suspended. Contact AgriMachConnect support." });
        }
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const token = createRoleSelectionToken(user);

        res.json({
            message: "Login successful",
            token,
            user: publicSessionUser(user)
        });
    } catch (error) {
        logAuthenticationFailure("Login", error);
        const databaseMessage = databaseFailureMessage(error);
        if (databaseMessage) {
            return res.status(503).json({ message: databaseMessage });
        }
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/select-role", authenticateSelectionSession, async (req, res) => {
    const requestedRole = req.body?.role;
    if (requestedRole && !["farmer", "owner"].includes(requestedRole)) {
        return res.status(400).json({ message: "Select Farmer or Machinery Owner." });
    }
    if (!process.env.JWT_SECRET?.trim()) {
        return res.status(503).json({ message: "Session setup is unavailable because JWT_SECRET is not configured." });
    }

    try {
        const account = await pool.query(
            `SELECT id, name, email, role, allowed_roles, selected_location,
                    selected_latitude, selected_longitude,
                    farm_location, farm_latitude, farm_longitude
             FROM users
             WHERE id = $1 AND is_suspended = FALSE`,
            [req.user.id]
        );
        if (!account.rows.length) {
            return res.status(401).json({ message: "Your account is unavailable. Please log in again." });
        }
        const user = account.rows[0];

        // Roles are permanent and fixed at registration; reject any attempt to change role
        if (requestedRole && requestedRole !== user.role) {
            return res.status(403).json({
                message: "User roles are permanent and cannot be changed after registration."
            });
        }

        if (!hasConfirmedLocation(user)) {
            return res.status(409).json({
                code: "LOCATION_CONFIRMATION_REQUIRED",
                message: `Confirm a location within ${LOCATION_RADIUS_KM} km of Sullia before opening your dashboard.`
            });
        }

        res.json({
            token: createActiveRoleToken(user),
            user: publicSessionUser(user)
        });
    } catch (error) {
        logAuthenticationFailure("Role selection", error);
        const databaseMessage = databaseFailureMessage(error);
        if (databaseMessage) {
            return res.status(503).json({ message: databaseMessage });
        }
        res.status(500).json({ message: "Could not select the requested account role." });
    }
});

router.get("/location-config", (req, res) => {
    res.json({
        center: SULLIA_CENTER,
        radiusKm: LOCATION_RADIUS_KM
    });
});

router.get("/session", authenticateSelectionSession, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role, allowed_roles,
                    selected_location, selected_latitude, selected_longitude,
                    farm_location, farm_latitude, farm_longitude
             FROM users
             WHERE id = $1`,
            [req.user.id]
        );
        if (!result.rows.length) {
            return res.status(401).json({
                message: "Your account could not be found. Please log in again."
            });
        }

        const user = result.rows[0];
        const token = createActiveRoleToken(user);
        res.json({
            token,
            user: publicSessionUser(user)
        });
    } catch (error) {
        logAuthenticationFailure("Session refresh", error);
        const databaseMessage = databaseFailureMessage(error);
        if (databaseMessage) {
            return res.status(503).json({ message: databaseMessage });
        }
        res.status(500).json({ message: "Could not refresh your account permissions." });
    }
});

router.patch("/confirm-location", authenticateSelectionSession, async (req, res) => {
    try {
        const { role: requestedRole, location, latitude, longitude } = req.body;

        const accountResult = await pool.query(
            `SELECT id, name, email, phone, role, allowed_roles,
                    selected_location, selected_latitude, selected_longitude,
                    farm_location, farm_latitude, farm_longitude, is_suspended
             FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (!accountResult.rows.length) {
            return res.status(401).json({ message: "Your account could not be found. Please log in again." });
        }
        const account = accountResult.rows[0];
        if (account.is_suspended) {
            return res.status(403).json({ message: "This account is suspended. Contact AgriMachConnect support." });
        }

        // Roles are permanent and fixed at registration; reject any attempt to change role
        if (requestedRole && requestedRole !== account.role) {
            return res.status(403).json({
                message: "User roles are permanent and cannot be changed after registration."
            });
        }

        if (typeof location !== "string" || !location.trim() || location.trim().length > 300) {
            return res.status(400).json({ message: "Select a village or address from the location search" });
        }
        if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 ||
            longitude < -180 || longitude > 180
        ) {
            return res.status(400).json({ message: "Choose a valid map location" });
        }
        if (!isWithinLocationRadius(latitude, longitude)) {
            return res.status(400).json({
                message: `Choose a location within ${LOCATION_RADIUS_KM} km of Sullia, Karnataka.`
            });
        }
        if (!process.env.JWT_SECRET) {
            return res.status(503).json({ message: "Session setup is unavailable because JWT_SECRET is not configured." });
        }

        // Update location while keeping role permanent
        const result = await pool.query(
            `UPDATE users
             SET selected_location = $2,
                 selected_latitude = $3,
                 selected_longitude = $4,
                 farm_location = CASE WHEN role = 'farmer' THEN $2 ELSE farm_location END,
                 farm_latitude = CASE WHEN role = 'farmer' THEN $3 ELSE farm_latitude END,
                 farm_longitude = CASE WHEN role = 'farmer' THEN $4 ELSE farm_longitude END
             WHERE id = $1
             RETURNING id, name, email, phone, role, allowed_roles,
                       selected_location, selected_latitude, selected_longitude,
                       farm_location, farm_latitude, farm_longitude`,
            [req.user.id, location.trim(), latitude, longitude]
        );

        const user = result.rows[0];
        const token = createActiveRoleToken(user);
        res.json({
            message: "Location confirmed",
            token,
            user: publicSessionUser(user)
        });
    } catch (error) {
        console.error("Location confirmation failed:", error.message);
        if (isDatabaseUnavailable(error)) {
            return res.status(503).json({
                message: "PostgreSQL is unavailable. Start the database and verify DB_* settings in backend/.env."
            });
        }
        res.status(500).json({ message: "Could not save your location." });
    }
});

module.exports = router;
