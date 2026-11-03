
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function authenticate(req, res, next, selectionOnly) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Please log in first"
        });
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!selectionOnly && (decoded.role === "pending" || decoded.locationConfirmed !== true)) {
            return res.status(403).json({
                code: "ROLE_LOCATION_REQUIRED",
                message: "Confirm your role and location before using this service."
            });
        }
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }

    pool.query(
        "SELECT role, allowed_roles, is_suspended FROM users WHERE id = $1",
        [decoded.id]
    ).then(result => {
        if (!result.rows.length) {
            return res.status(401).json({ message: "Your account could not be found. Please log in again." });
        }
        const account = result.rows[0];
        if (account.is_suspended) {
            return res.status(403).json({
                code: "ACCOUNT_SUSPENDED",
                message: "This account is suspended. Contact AgriMachConnect support."
            });
        }
        if (
            !selectionOnly &&
            (account.role !== decoded.role || !account.allowed_roles.includes(decoded.role))
        ) {
            return res.status(403).json({
                message: "Your session role is no longer authorized. Please log in again."
            });
        }
        // Authoritative role from the database is always enforced on req.user
        req.user = {
            ...decoded,
            id: decoded.id,
            role: account.role,
            permittedRoles: [account.role]
        };
        next();
    }).catch(error => {
        console.error("Session authorization failed:", error.message);
        const isDatabaseUnavailable = [
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ENOTFOUND",
            "57P03"
        ].includes(error.code) ||
            (typeof error.code === "string" && error.code.startsWith("08"));
        res.status(isDatabaseUnavailable ? 503 : 500).json({
            message: isDatabaseUnavailable
                ? "Supabase PostgreSQL is unavailable. Verify DATABASE_URL and database access in backend/.env."
                : "Could not verify your account authorization."
        });
    });
}

function authenticateToken(req, res, next) {
    authenticate(req, res, next, false);
}

function authenticateSelectionSession(req, res, next) {
    authenticate(req, res, next, true);
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                message: "You are not authorized to perform this action"
            });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    authenticateSelectionSession,
    requireRole
};
