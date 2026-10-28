const jwt = require("jsonwebtoken");
const pool = require("../config/db");

function authenticateAdmin(req, res, next) {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Admin sign-in is required." });
    }

    let decoded;
    try {
        decoded = jwt.verify(authorization.slice(7), process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ message: "Admin session is invalid or expired. Sign in again." });
    }
    if (decoded.kind !== "admin" || !decoded.adminId || !Number.isInteger(decoded.tokenVersion)) {
        return res.status(403).json({ message: "An administrator account is required." });
    }

    pool.query(
        "SELECT id, name, email, is_active, token_version FROM admin_accounts WHERE id = $1",
        [decoded.adminId]
    ).then(result => {
        const admin = result.rows[0];
        if (!admin || !admin.is_active) {
            return res.status(403).json({ message: "This administrator account is inactive." });
        }
        if (decoded.tokenVersion !== admin.token_version) {
            return res.status(401).json({ message: "Admin session was revoked. Sign in again." });
        }
        req.admin = admin;
        next();
    }).catch(error => {
        console.error("Admin authorization failed:", error.message);
        const unavailable = typeof error.code === "string" && error.code.startsWith("08") ||
            ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "57P03"].includes(error.code);
        res.status(unavailable ? 503 : 500).json({
            message: unavailable
                ? "PostgreSQL is unavailable. Verify the configured database connection."
                : "Could not verify administrator authorization."
        });
    });
}

module.exports = { authenticateAdmin };
