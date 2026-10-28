const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { authenticateAdmin } = require("../middleware/adminAuthMiddleware");
const { authenticateSelectionSession } = require("../middleware/authMiddleware");

const router = express.Router();
const VALID_ROLES = new Set(["farmer", "owner"]);
const BOOKING_STATUSES = new Set(["pending", "accepted", "rejected", "cancelled", "completed"]);

function pagination(query) {
    const requestedPage = Number.parseInt(query.page, 10);
    const requestedLimit = Number.parseInt(query.limit, 10);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
    return { page, limit, offset: (page - 1) * limit };
}

function searchTerm(value) {
    return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function validId(value) {
    return /^\d+$/.test(String(value ?? ""));
}

function errorResponse(res, error, message) {
    const errorCode = typeof error.code === "string" ? error.code : "unknown";
    console.error("Admin request failed:", { operation: message, code: errorCode });
    if (["42P01", "42703", "3F000"].includes(errorCode)) {
        return res.status(503).json({
            message: "Admin authentication database schema is incomplete. Run npm run migrate:admin from the backend folder."
        });
    }
    const unavailable = typeof error.code === "string" && error.code.startsWith("08") ||
        ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "57P03"].includes(error.code);
    res.status(unavailable ? 503 : 500).json({
        message: unavailable ? "PostgreSQL is unavailable. Verify the configured database connection." : message
    });
}

async function writeAudit(database, adminId, action, entityType, entityId, details = {}, outcome = "success") {
    await database.query(
        `INSERT INTO admin_audit_logs (admin_id, action, entity_type, entity_id, outcome, details)
         VALUES ($1, $2, $3, $4, $5, $6::JSONB)`,
        [adminId, action, entityType, entityId == null ? null : String(entityId), outcome, JSON.stringify(details)]
    );
}

async function withTransaction(work) {
    const client = await pool.connect();
    let open = false;
    try {
        await client.query("BEGIN");
        open = true;
        const result = await work(client);
        await client.query("COMMIT");
        open = false;
        return result;
    } catch (error) {
        if (open) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Admin transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

function safeAdmin(admin) {
    return { id: admin.id, name: admin.name, email: admin.email };
}

router.post("/login", async (req, res) => {
    try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
        const password = req.body?.password;
        if (!email || typeof password !== "string" || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }
        if (!process.env.JWT_SECRET?.trim()) {
            return res.status(503).json({ message: "Admin authentication is not configured." });
        }
        const result = await pool.query(
            "SELECT id, name, email, password, is_active, token_version FROM admin_accounts WHERE email = $1",
            [email]
        );
        const admin = result.rows[0];
        if (!admin || !await bcrypt.compare(password, admin.password)) {
            return res.status(401).json({ message: "Invalid admin email or password." });
        }
        if (!admin.is_active) {
            return res.status(403).json({ message: "This administrator account is inactive." });
        }
        const token = jwt.sign(
            { kind: "admin", adminId: admin.id, tokenVersion: admin.token_version },
            process.env.JWT_SECRET,
            { expiresIn: "8h" }
        );
        res.json({ token, admin: safeAdmin(admin) });
    } catch (error) {
        errorResponse(res, error, "Admin sign-in could not be completed.");
    }
});

router.post("/owner-access-requests", authenticateSelectionSession, async (req, res) => {
    try {
        const userResult = await pool.query(
            "SELECT allowed_roles FROM users WHERE id = $1 AND is_suspended = FALSE",
            [req.user.id]
        );
        if (!userResult.rows.length) {
            return res.status(403).json({ message: "An active user account is required to request Owner access." });
        }
        if (userResult.rows[0].allowed_roles.includes("owner")) {
            return res.status(409).json({ message: "This account already has Machinery Owner access." });
        }
        const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
        const result = await pool.query(
            `INSERT INTO owner_access_requests (user_id, status, request_note)
             VALUES ($1, 'Pending', $2)
             ON CONFLICT (user_id) WHERE lower(status) = 'pending'
             DO UPDATE SET request_note = EXCLUDED.request_note, status = 'Pending', created_at = NOW()
             RETURNING id, user_id, status, request_note, created_at`,
            [req.user.id, note || null]
        );
        res.status(201).json({ request: result.rows[0] });
    } catch (error) {
        errorResponse(res, error, "Owner access request could not be saved.");
    }
});

router.get("/owner-access-requests/current", authenticateSelectionSession, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, status, request_note, review_note, created_at, reviewed_at
             FROM owner_access_requests WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.id]
        );
        res.json({ request: result.rows[0] || null });
    } catch (error) {
        errorResponse(res, error, "Owner access request status could not be loaded.");
    }
});

router.use(authenticateAdmin);

router.get("/session", (req, res) => res.json({ admin: safeAdmin(req.admin) }));

router.post("/logout", (req, res) => {
    withTransaction(async client => {
        await client.query(
            "UPDATE admin_accounts SET token_version = token_version + 1 WHERE id = $1",
            [req.admin.id]
        );
        await writeAudit(client, req.admin.id, "admin.logged_out", "admin", req.admin.id);
    }).then(() => res.json({ message: "Admin session revoked." }))
        .catch(error => errorResponse(res, error, "Admin session could not be revoked."));
});

router.post("/change-password", async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || !currentPassword ||
        typeof newPassword !== "string" || newPassword.length < 12) {
        return res.status(400).json({ message: "Enter your current password and a new password of at least 12 characters." });
    }
    try {
        const current = await pool.query("SELECT password FROM admin_accounts WHERE id = $1", [req.admin.id]);
        if (!current.rows.length || !await bcrypt.compare(currentPassword, current.rows[0].password)) {
            return res.status(401).json({ message: "Current password is incorrect." });
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await withTransaction(async client => {
            await client.query(
                "UPDATE admin_accounts SET password = $1, password_changed_at = NOW() WHERE id = $2",
                [passwordHash, req.admin.id]
            );
            await writeAudit(client, req.admin.id, "admin.password_changed", "admin", req.admin.id);
        });
        res.json({ message: "Admin password updated." });
    } catch (error) {
        errorResponse(res, error, "Admin password could not be changed.");
    }
});

router.get("/overview", async (req, res) => {
    try {
        const [users, roles, requests, machinery, bookings, statuses, activity] = await Promise.all([
            pool.query("SELECT COUNT(*)::INT AS total FROM users"),
            pool.query(
                `SELECT COUNT(*) FILTER (WHERE 'farmer' = ANY(allowed_roles))::INT AS farmers,
                        COUNT(*) FILTER (WHERE 'owner' = ANY(allowed_roles))::INT AS owners
                 FROM users WHERE is_suspended = FALSE`
            ),
            pool.query("SELECT COUNT(*)::INT AS total FROM owner_access_requests WHERE lower(status) = 'pending'"),
            pool.query(
                "SELECT COUNT(*)::INT AS total, COUNT(*) FILTER (WHERE availability AND admin_active)::INT AS available FROM machinery"
            ),
            pool.query("SELECT COUNT(*)::INT AS total FROM bookings"),
            pool.query("SELECT status, COUNT(*)::INT AS count FROM bookings GROUP BY status"),
            pool.query(
                `SELECT l.id, l.admin_id, a.name AS admin_name, l.action, l.entity_type,
                        l.entity_id, l.outcome, l.details, l.created_at
                 FROM admin_audit_logs l JOIN admin_accounts a ON a.id = l.admin_id
                 ORDER BY l.created_at DESC LIMIT 10`
            )
        ]);
        const byStatus = Object.fromEntries(["pending", "accepted", "rejected", "cancelled", "completed"].map(status => [status, 0]));
        for (const row of statuses.rows) byStatus[row.status] = row.count;
        res.json({
            summary: {
                totalUsers: users.rows[0].total,
                farmerAccounts: roles.rows[0].farmers,
                ownerAccounts: roles.rows[0].owners,
                pendingOwnerRequests: requests.rows[0].total,
                totalMachinery: machinery.rows[0].total,
                availableMachinery: machinery.rows[0].available,
                totalBookings: bookings.rows[0].total,
                pendingBookings: byStatus.pending,
                acceptedBookings: byStatus.accepted,
                rejectedBookings: byStatus.rejected,
                cancelledBookings: byStatus.cancelled,
                completedBookings: byStatus.completed
            },
            bookingsByStatus: byStatus,
            recentActivity: activity.rows
        });
    } catch (error) {
        errorResponse(res, error, "Admin dashboard summary could not be loaded.");
    }
});

router.get("/owner-requests", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const status = typeof req.query.status === "string" &&
        ["pending", "approved", "rejected", "revoked", "all"].includes(req.query.status)
        ? req.query.status : "pending";
    const search = searchTerm(req.query.search);
    try {
        const params = [];
        const conditions = [];
        if (status !== "all") {
            params.push(status);
            conditions.push(`lower(r.status) = lower($${params.length})`);
        }
        if (search) {
            params.push(`%${search}%`);
            conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.id::TEXT = $${params.length})`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const count = await pool.query(
            `SELECT COUNT(*)::INT AS total FROM owner_access_requests r JOIN users u ON u.id = r.user_id ${where}`,
            params
        );
        const rows = await pool.query(
            `SELECT r.id, r.user_id, u.name, u.email, u.phone, u.role,
                    u.allowed_roles AS current_roles, u.created_at AS registration_date,
                    r.status, r.request_note, r.review_note, r.created_at AS requested_at,
                    r.reviewed_at, r.reviewed_by
             FROM owner_access_requests r JOIN users u ON u.id = r.user_id
             ${where} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json({ items: rows.rows, pagination: { page, limit, total: count.rows[0].total } });
    } catch (error) {
        errorResponse(res, error, "Owner access requests could not be loaded.");
    }
});

router.post("/owner-requests/:id/approve", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid owner request ID." });
    try {
        const approved = await withTransaction(async client => {
            const request = await client.query(
                `SELECT id, user_id, status FROM owner_access_requests WHERE id = $1 FOR UPDATE`,
                [req.params.id]
            );
            if (!request.rows.length) return { missing: true };
            if (String(request.rows[0].status).toLowerCase() !== "pending") return { conflict: true };
            const user = await client.query(
                `UPDATE users SET allowed_roles = ARRAY(SELECT DISTINCT unnest(allowed_roles || ARRAY['owner']::TEXT[]))
                 WHERE id = $1 AND is_suspended = FALSE
                 RETURNING id, role, allowed_roles`,
                [request.rows[0].user_id]
            );
            if (!user.rows.length) return { inactive: true };
            await client.query(
                `UPDATE owner_access_requests
                 SET status = 'approved', review_note = $2, reviewed_by = $3, reviewed_at = NOW()
                 WHERE id = $1`,
                [request.rows[0].id, typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null, req.admin.id]
            );
            await writeAudit(client, req.admin.id, "owner_access.approved", "user", user.rows[0].id, {
                requestId: request.rows[0].id,
                allowedRoles: user.rows[0].allowed_roles
            });
            return { user: user.rows[0] };
        });
        if (approved.missing) return res.status(404).json({ message: "Owner access request was not found." });
        if (approved.conflict) return res.status(409).json({ message: "This request has already been reviewed." });
        if (approved.inactive) return res.status(409).json({ message: "Suspended or missing users cannot be approved." });
        res.json({ message: "Owner access approved.", user: approved.user });
    } catch (error) {
        errorResponse(res, error, "Owner access could not be approved.");
    }
});

router.post("/owner-requests/:id/reject", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid owner request ID." });
    try {
        const result = await withTransaction(async client => {
            const request = await client.query(
                "SELECT id, user_id FROM owner_access_requests WHERE id = $1 AND (status = 'pending' OR lower(status) = 'pending') FOR UPDATE",
                [req.params.id]
            );
            if (!request.rows.length) return null;
            await client.query(
                `UPDATE owner_access_requests SET status = 'rejected',
                     review_note = $1, reviewed_by = $2, reviewed_at = NOW()
                 WHERE id = $3`,
                [typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null, req.admin.id, req.params.id]
            );
            await writeAudit(client, req.admin.id, "owner_access.rejected", "user", request.rows[0].user_id, {
                requestId: request.rows[0].id
            });
            return request.rows[0];
        });
        if (!result) return res.status(404).json({ message: "Pending owner access request was not found." });
        res.json({ message: "Owner access request rejected." });
    } catch (error) {
        errorResponse(res, error, "Owner access request could not be rejected.");
    }
});

router.get("/users", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const search = searchTerm(req.query.search);
    const role = ["farmer", "owner"].includes(req.query.role) ? req.query.role : "";
    const status = ["active", "suspended"].includes(req.query.status) ? req.query.status : "";
    const params = [];
    const conditions = [];
    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR id::TEXT = $${params.length})`);
    }
    if (role) {
        params.push(role);
        conditions.push(`$${params.length} = ANY(allowed_roles)`);
    }
    if (status) {
        params.push(status === "suspended");
        conditions.push(`is_suspended = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    try {
        const count = await pool.query(`SELECT COUNT(*)::INT AS total FROM users ${where}`, params);
        const result = await pool.query(
            `SELECT id, name, email, phone, role, allowed_roles AS permitted_roles,
                    is_suspended, created_at
             FROM users ${where}
             ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json({ items: result.rows, pagination: { page, limit, total: count.rows[0].total } });
    } catch (error) {
        errorResponse(res, error, "Users could not be loaded.");
    }
});

router.get("/users/:id", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid user ID." });
    try {
        const [user, machinery, bookings] = await Promise.all([
            pool.query(
                `SELECT id, name, email, phone, role, allowed_roles AS permitted_roles,
                        is_suspended, created_at, selected_location, selected_latitude, selected_longitude
                 FROM users WHERE id = $1`,
                [req.params.id]
            ),
            pool.query(
                `SELECT id, name, type, price, price_unit, location, latitude, longitude,
                        availability, admin_active, created_at
                 FROM machinery WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`,
                [req.params.id]
            ),
            pool.query(
                `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status, b.created_at,
                        b.rental_rate, b.rental_unit, b.estimated_total, m.name AS machinery_name
                 FROM bookings b JOIN machinery m ON m.id = b.machinery_id
                 WHERE b.farmer_id = $1 OR m.owner_id = $1
                 ORDER BY b.created_at DESC LIMIT 100`,
                [req.params.id]
            )
        ]);
        if (!user.rows.length) return res.status(404).json({ message: "User was not found." });
        res.json({ user: user.rows[0], machinery: machinery.rows, bookings: bookings.rows });
    } catch (error) {
        errorResponse(res, error, "User details could not be loaded.");
    }
});

router.patch("/users/:id/roles", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid user ID." });
    const roles = req.body?.roles;
    if (!Array.isArray(roles) || roles.length === 0 ||
        roles.some(role => !VALID_ROLES.has(role)) || new Set(roles).size !== roles.length) {
        return res.status(400).json({ message: "Choose one or both valid roles: farmer and owner." });
    }
    try {
        const result = await withTransaction(async client => {
            const user = await client.query("SELECT id, role, allowed_roles FROM users WHERE id = $1 FOR UPDATE", [req.params.id]);
            if (!user.rows.length) return null;
            const oldRoles = user.rows[0].allowed_roles;
            const selectedRole = roles.includes(user.rows[0].role) ? user.rows[0].role : roles[0];
            const update = await client.query(
                `UPDATE users SET role = $1, allowed_roles = $2::TEXT[]
                 WHERE id = $3 RETURNING id, role, allowed_roles`,
                [selectedRole, roles, req.params.id]
            );
            await writeAudit(client, req.admin.id, roles.includes("owner") ? "user.owner_granted" : "user.owner_revoked",
                "user", req.params.id, { previousRoles: oldRoles, permittedRoles: roles });
            if (oldRoles.includes("owner") && !roles.includes("owner")) {
                await client.query(
                    `UPDATE owner_access_requests
                     SET status = 'revoked', reviewed_by = $2, reviewed_at = NOW()
                     WHERE id = (
                         SELECT id FROM owner_access_requests
                         WHERE user_id = $1 AND status = 'approved'
                         ORDER BY reviewed_at DESC LIMIT 1
                     )`,
                    [req.params.id, req.admin.id]
                );
            }
            return update.rows[0];
        });
        if (!result) return res.status(404).json({ message: "User was not found." });
        res.json({ user: result });
    } catch (error) {
        errorResponse(res, error, "User permissions could not be updated.");
    }
});

router.patch("/users/:id/status", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid user ID." });
    if (typeof req.body?.suspended !== "boolean") {
        return res.status(400).json({ message: "Choose whether to suspend this account." });
    }
    try {
        const user = await withTransaction(async client => {
            const result = await client.query(
                `UPDATE users SET is_suspended = $1 WHERE id = $2
                 RETURNING id, name, email, is_suspended`,
                [req.body.suspended, req.params.id]
            );
            if (!result.rows.length) return null;
            await writeAudit(client, req.admin.id, req.body.suspended ? "user.suspended" : "user.reactivated",
                "user", req.params.id);
            return result.rows[0];
        });
        if (!user) return res.status(404).json({ message: "User was not found." });
        res.json({ user });
    } catch (error) {
        errorResponse(res, error, "User account status could not be updated.");
    }
});

router.get("/machinery", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const search = searchTerm(req.query.search);
    const active = ["active", "inactive"].includes(req.query.status) ? req.query.status : "";
    const params = [];
    const conditions = [];
    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(m.name ILIKE $${params.length} OR m.type ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR m.id::TEXT = $${params.length})`);
    }
    if (active) {
        params.push(active === "active");
        conditions.push(`m.admin_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const from = "FROM machinery m JOIN users u ON u.id = m.owner_id";
    try {
        const count = await pool.query(`SELECT COUNT(*)::INT AS total ${from} ${where}`, params);
        const result = await pool.query(
            `SELECT m.id, m.name, m.type, m.price, m.price_unit, m.location, m.latitude,
                    m.longitude, m.availability, m.admin_active, m.image_url, m.created_at,
                    m.owner_id, u.name AS owner_name, u.email AS owner_email
             ${from} ${where} ORDER BY m.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json({ items: result.rows, pagination: { page, limit, total: count.rows[0].total } });
    } catch (error) {
        errorResponse(res, error, "Machinery listings could not be loaded.");
    }
});

router.patch("/machinery/:id/status", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid machinery ID." });
    if (typeof req.body?.active !== "boolean") return res.status(400).json({ message: "Choose whether to activate this listing." });
    try {
        const machinery = await withTransaction(async client => {
            const result = await client.query(
                `UPDATE machinery SET admin_active = $1 WHERE id = $2 RETURNING id, name, admin_active`,
                [req.body.active, req.params.id]
            );
            if (!result.rows.length) return null;
            await writeAudit(client, req.admin.id, req.body.active ? "machinery.activated" : "machinery.deactivated",
                "machinery", req.params.id);
            return result.rows[0];
        });
        if (!machinery) return res.status(404).json({ message: "Machinery listing was not found." });
        res.json({ machinery });
    } catch (error) {
        errorResponse(res, error, "Machinery listing status could not be updated.");
    }
});

router.get("/bookings", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const search = searchTerm(req.query.search);
    const status = BOOKING_STATUSES.has(req.query.status) ? req.query.status : "";
    const sortColumns = {
        created: "b.created_at",
        date: "b.booking_date",
        status: "b.status",
        rental: "b.estimated_total"
    };
    const sortColumn = sortColumns[req.query.sort] || sortColumns.created;
    const sortOrder = req.query.order === "asc" ? "ASC" : "DESC";
    const params = [];
    const conditions = [];
    if (status) {
        params.push(status);
        conditions.push(`b.status = $${params.length}`);
    }
    if (search) {
        params.push(`%${search}%`);
        conditions.push(`(f.name ILIKE $${params.length} OR f.email ILIKE $${params.length} OR o.name ILIKE $${params.length} OR m.name ILIKE $${params.length} OR b.id::TEXT = $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const from = "FROM bookings b JOIN users f ON f.id = b.farmer_id JOIN machinery m ON m.id = b.machinery_id JOIN users o ON o.id = m.owner_id";
    try {
        const count = await pool.query(`SELECT COUNT(*)::INT AS total ${from} ${where}`, params);
        const result = await pool.query(
            `SELECT b.id, b.farmer_id, f.name AS farmer_name, m.id AS machinery_id,
                    m.name AS machinery_name, m.owner_id, o.name AS owner_name,
                    b.booking_date, b.start_time, b.end_time, b.rental_rate, b.rental_unit,
                    b.estimated_total, b.status, b.created_at
             ${from} ${where} ORDER BY ${sortColumn} ${sortOrder}
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json({ items: result.rows, pagination: { page, limit, total: count.rows[0].total } });
    } catch (error) {
        errorResponse(res, error, "Bookings could not be loaded.");
    }
});

router.patch("/bookings/:id/status", async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid booking ID." });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    if (req.body?.status !== "cancelled" || reason.length < 3) {
        return res.status(400).json({ message: "Only cancellation of an active booking with a reason is supported." });
    }
    try {
        const result = await withTransaction(async client => {
            const booking = await client.query("SELECT id, status FROM bookings WHERE id = $1 FOR UPDATE", [req.params.id]);
            if (!booking.rows.length) return { missing: true };
            if (!["pending", "accepted"].includes(booking.rows[0].status)) return { conflict: true };
            const update = await client.query(
                "UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING id, status",
                [req.params.id]
            );
            await writeAudit(client, req.admin.id, "booking.cancelled_by_admin", "booking", req.params.id, { reason });
            return { booking: update.rows[0] };
        });
        if (result.missing) return res.status(404).json({ message: "Booking was not found." });
        if (result.conflict) return res.status(409).json({ message: "Only pending or accepted bookings can be cancelled." });
        res.json({ booking: result.booking });
    } catch (error) {
        errorResponse(res, error, "Booking could not be cancelled.");
    }
});

router.get("/audit", async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const search = searchTerm(req.query.search);
    const params = [];
    let where = "";
    if (search) {
        params.push(`%${search}%`);
        where = `WHERE l.action ILIKE $1 OR l.entity_type ILIKE $1 OR l.entity_id ILIKE $1 OR a.name ILIKE $1 OR a.email ILIKE $1`;
    }
    try {
        const count = await pool.query(
            `SELECT COUNT(*)::INT AS total FROM admin_audit_logs l JOIN admin_accounts a ON a.id = l.admin_id ${where}`,
            params
        );
        const result = await pool.query(
            `SELECT l.id, l.admin_id, a.name AS admin_name, l.action, l.entity_type,
                    l.entity_id, l.outcome, l.details, l.created_at
             FROM admin_audit_logs l JOIN admin_accounts a ON a.id = l.admin_id
             ${where} ORDER BY l.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );
        res.json({ items: result.rows, pagination: { page, limit, total: count.rows[0].total } });
    } catch (error) {
        errorResponse(res, error, "Administrative audit history could not be loaded.");
    }
});

module.exports = router;
