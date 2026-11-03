const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, before, test } = require("node:test");
const bcrypt = require("bcrypt");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "admin-dashboard-test-secret";

const admins = new Map();
const users = new Map();
const ownerRequests = new Map();
const machinery = new Map();
const bookings = new Map();
const auditLogs = [];
let adminLoginDatabaseError = null;
let nextRequestId = 1;
const databaseModulePath = require.resolve("../../config/db");
const databaseModule = new Module(databaseModulePath);
databaseModule.filename = databaseModulePath;
databaseModule.loaded = true;
databaseModule.exports = {
    async query(sql, values = []) {
        if (sql.includes("SELECT id, name, email, password, is_active, token_version FROM admin_accounts WHERE email")) {
            if (adminLoginDatabaseError) throw adminLoginDatabaseError;
            const admin = Array.from(admins.values()).find(item => item.email === values[0]);
            return { rows: admin ? [{ ...admin }] : [] };
        }
        if (sql.includes("SELECT id, name, email, is_active, token_version FROM admin_accounts WHERE id")) {
            const admin = admins.get(Number(values[0]));
            return { rows: admin ? [{ id: admin.id, name: admin.name, email: admin.email, is_active: admin.is_active, token_version: admin.token_version }] : [] };
        }
        if (sql.includes("SELECT role, allowed_roles, is_suspended FROM users")) {
            const user = users.get(Number(values[0]));
            return { rows: user ? [{ role: user.role, allowed_roles: user.allowed_roles, is_suspended: user.is_suspended }] : [] };
        }
        if (sql.includes("SELECT allowed_roles FROM users WHERE id = $1 AND is_suspended = FALSE")) {
            const user = users.get(Number(values[0]));
            return { rows: user && !user.is_suspended ? [{ allowed_roles: user.allowed_roles }] : [] };
        }
        if (sql.includes("INSERT INTO owner_access_requests")) {
            const existing = Array.from(ownerRequests.values()).find(item => item.user_id === Number(values[0]) && item.status === "pending");
            if (existing) {
                existing.request_note = values[1];
                return { rows: [{ ...existing }] };
            }
            const request = {
                id: nextRequestId++,
                user_id: Number(values[0]),
                status: "pending",
                request_note: values[1],
                created_at: new Date().toISOString()
            };
            ownerRequests.set(request.id, request);
            return { rows: [{ ...request }] };
        }
        if (sql.includes("INSERT INTO admin_audit_logs")) {
            const [adminId, action, entityType, entityId, outcome, details] = values;
            auditLogs.push({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, outcome, details: JSON.parse(details) });
            return { rows: [] };
        }
        if (sql.includes("SELECT id, status, request_note, review_note, created_at, reviewed_at")) {
            const request = Array.from(ownerRequests.values())
                .filter(item => item.user_id === Number(values[0]))
                .sort((first, second) => second.id - first.id)[0];
            return { rows: request ? [{ ...request }] : [] };
        }
        if (sql.includes("SELECT COUNT(*)::INT AS total FROM owner_access_requests")) {
            const status = values[0];
            return { rows: [{ total: Array.from(ownerRequests.values()).filter(item => item.status === status).length }] };
        }
        if (sql.includes("SELECT r.id, r.user_id")) {
            return { rows: Array.from(ownerRequests.values()).filter(item => item.status === values[0]).map(item => {
                const user = users.get(item.user_id);
                return {
                    ...item,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    current_roles: user.allowed_roles,
                    registration_date: user.created_at,
                    requested_at: item.created_at
                };
            }) };
        }
        if (sql.includes("SELECT id, password FROM admin_accounts")) {
            const admin = admins.get(Number(values[0]));
            return { rows: admin ? [{ id: admin.id, password: admin.password }] : [] };
        }
        throw new Error(`Unexpected test database query: ${sql}`);
    },
    async connect() {
        return {
            async query(sql, values = []) {
                if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
                if (sql.includes("UPDATE admin_accounts SET token_version = token_version + 1")) {
                    const admin = admins.get(Number(values[0]));
                    admin.token_version += 1;
                    return { rows: [] };
                }
                if (sql.includes("SELECT id, user_id, status FROM owner_access_requests")) {
                    const request = ownerRequests.get(Number(values[0]));
                    return { rows: request ? [{ id: request.id, user_id: request.user_id, status: request.status }] : [] };
                }
                if (sql.includes("SELECT id, user_id FROM owner_access_requests") && sql.includes("status = 'pending'")) {
                    const request = ownerRequests.get(Number(values[0]));
                    return { rows: request?.status === "pending" ? [{ id: request.id, user_id: request.user_id }] : [] };
                }
                if (sql.includes("UPDATE users SET allowed_roles = ARRAY")) {
                    const user = users.get(Number(values[0]));
                    if (!user || user.is_suspended) return { rows: [] };
                    user.allowed_roles = Array.from(new Set([...user.allowed_roles, "owner"]));
                    return { rows: [{ id: user.id, role: user.role, allowed_roles: user.allowed_roles }] };
                }
                if (sql.includes("SELECT id, role, allowed_roles FROM users")) {
                    const user = users.get(Number(values[0]));
                    return { rows: user ? [{ id: user.id, role: user.role, allowed_roles: user.allowed_roles }] : [] };
                }
                if (sql.includes("UPDATE users SET role = $1, allowed_roles = $2::TEXT[]")) {
                    const [role, allowedRoles, id] = values;
                    const user = users.get(Number(id));
                    if (!user) return { rows: [] };
                    user.role = role;
                    user.allowed_roles = allowedRoles;
                    return { rows: [{ id: user.id, role: user.role, allowed_roles: user.allowed_roles }] };
                }
                if (sql.includes("UPDATE owner_access_requests") && sql.includes("SET status = 'revoked'")) {
                    const [userId, adminId] = values;
                    const request = Array.from(ownerRequests.values())
                        .filter(item => item.user_id === Number(userId) && item.status === "approved")
                        .sort((first, second) => second.id - first.id)[0];
                    if (request) {
                        request.status = "revoked";
                        request.reviewed_by = adminId;
                    }
                    return { rows: [] };
                }
                if (sql.includes("UPDATE users SET is_suspended")) {
                    const [suspended, id] = values;
                    const user = users.get(Number(id));
                    if (!user) return { rows: [] };
                    user.is_suspended = suspended;
                    return { rows: [{ id: user.id, name: user.name, email: user.email, is_suspended: suspended }] };
                }
                if (sql.includes("UPDATE machinery SET admin_active")) {
                    const [active, id] = values;
                    const listing = machinery.get(Number(id));
                    if (!listing) return { rows: [] };
                    listing.admin_active = active;
                    return { rows: [{ id: listing.id, name: listing.name, admin_active: active }] };
                }
                if (sql.includes("SELECT id, status FROM bookings WHERE id")) {
                    const booking = bookings.get(Number(values[0]));
                    return { rows: booking ? [{ id: booking.id, status: booking.status }] : [] };
                }
                if (sql.includes("UPDATE bookings SET status = 'cancelled'")) {
                    const booking = bookings.get(Number(values[0]));
                    if (!booking) return { rows: [] };
                    booking.status = "cancelled";
                    return { rows: [{ id: booking.id, status: booking.status }] };
                }
                if (sql.includes("UPDATE owner_access_requests")) {
                    const rejected = sql.includes("status = 'rejected'");
                    const [id, note, adminId] = rejected
                        ? [values[2], values[0], values[1]]
                        : values;
                    const request = ownerRequests.get(Number(id));
                    request.status = rejected ? "rejected" : "approved";
                    request.review_note = note;
                    request.reviewed_by = adminId;
                    request.reviewed_at = new Date().toISOString();
                    return { rows: [] };
                }
                if (sql.includes("INSERT INTO admin_audit_logs")) {
                    const [adminId, action, entityType, entityId, outcome, details] = values;
                    auditLogs.push({ admin_id: adminId, action, entity_type: entityType, entity_id: entityId, outcome, details: JSON.parse(details) });
                    return { rows: [] };
                }
                throw new Error(`Unexpected transactional test query: ${sql}`);
            },
            release() {}
        };
    }
};
require.cache[databaseModulePath] = databaseModule;

const adminRoutes = require("../../routes/adminRoutes");
const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

let server;
let baseUrl;
let adminToken;
let userToken;

before(async () => {
    const password = await bcrypt.hash("secure-admin-password", 4);
    admins.set(7, { id: 7, name: "Test Admin", email: "admin@example.invalid", password, is_active: true, token_version: 0 });
    users.set(21, {
        id: 21,
        name: "Farmer Test",
        email: "farmer@example.invalid",
        phone: "9876543210",
        role: "farmer",
        allowed_roles: ["farmer"],
        is_suspended: false,
        created_at: new Date().toISOString()
    });
    machinery.set(30, { id: 30, name: "Test Tractor", admin_active: true });
    bookings.set(51, { id: 51, status: "pending" });
    server = await new Promise(resolve => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("admin login is separate from user auth and rejects invalid credentials", async () => {
    const invalid = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.invalid", password: "wrong" })
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { message: "Invalid admin email or password." });

    const missingAccount = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "unknown@example.invalid", password: "validly-shaped-password" })
    });
    assert.equal(missingAccount.status, 401);
    assert.deepEqual(await missingAccount.json(), { message: "Invalid admin email or password." });

    const response = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ADMIN@example.invalid", password: "secure-admin-password" })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    adminToken = result.token;
    assert.deepEqual(result.admin, { id: 7, name: "Test Admin", email: "admin@example.invalid" });
    assert.equal(jwt.verify(adminToken, process.env.JWT_SECRET).kind, "admin");

    const configuredSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
        const unconfigured = await fetch(`${baseUrl}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "admin@example.invalid", password: "secure-admin-password" })
        });
        assert.equal(unconfigured.status, 503);
        assert.deepEqual(await unconfigured.json(), { message: "Admin authentication is not configured." });
    } finally {
        process.env.JWT_SECRET = configuredSecret;
    }
});

test("Admin login reports schema and database failures without exposing database details", async () => {
    adminLoginDatabaseError = Object.assign(new Error("relation admin_accounts does not exist"), { code: "42P01" });
    const missingSchema = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.invalid", password: "password-that-is-not-logged" })
    });
    assert.equal(missingSchema.status, 503);
    const schemaMessage = await missingSchema.json();
    assert.match(schemaMessage.message, /npm run migrate:admin/);
    assert.equal(JSON.stringify(schemaMessage).includes("password-that-is-not-logged"), false);

    adminLoginDatabaseError = Object.assign(new Error("connection failure with internal details"), { code: "08006" });
    const databaseUnavailable = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.invalid", password: "password-that-is-not-logged" })
    });
    assert.equal(databaseUnavailable.status, 503);
    const databaseMessage = await databaseUnavailable.json();
    assert.match(databaseMessage.message, /PostgreSQL is unavailable/);
    assert.equal(JSON.stringify(databaseMessage).includes("internal details"), false);
    adminLoginDatabaseError = null;
});

test("admin APIs reject missing, user, and expired tokens", async () => {
    const missing = await fetch(`${baseUrl}/overview`);
    assert.equal(missing.status, 401);
    userToken = jwt.sign({ id: 21, role: "pending", locationConfirmed: false }, process.env.JWT_SECRET);
    const ordinaryUser = await fetch(`${baseUrl}/overview`, {
        headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(ordinaryUser.status, 403);
    const expired = jwt.sign(
        { kind: "admin", adminId: 7 },
        process.env.JWT_SECRET,
        { expiresIn: -1 }
    );
    const expiredResponse = await fetch(`${baseUrl}/overview`, {
        headers: { Authorization: `Bearer ${expired}` }
    });
    assert.equal(expiredResponse.status, 401);
});

test("Farmer can request Owner access but only an authenticated admin can approve it", async () => {
    const request = await fetch(`${baseUrl}/owner-access-requests`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ note: "I need to list my tractor." })
    });
    assert.equal(request.status, 201);
    const created = await request.json();
    assert.equal(created.request.status, "pending");
    assert.deepEqual(users.get(21).allowed_roles, ["farmer"]);

    const forbidden = await fetch(`${baseUrl}/owner-requests/1/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(users.get(21).allowed_roles, ["farmer"]);

    const beforeApproval = await fetch(`${baseUrl}/owner-requests`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(beforeApproval.status, 200);
    const list = await beforeApproval.json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].name, users.get(21).name);
    assert.equal(list.items[0].email, users.get(21).email);
    assert.deepEqual(list.items[0].current_roles, ["farmer"]);
    assert.equal(list.items[0].status, "pending");
    assert.ok(list.items[0].requested_at);

    const approved = await fetch(`${baseUrl}/owner-requests/1/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: "Verified equipment owner." })
    });
    assert.equal(approved.status, 200);
    assert.deepEqual(users.get(21).allowed_roles, ["farmer", "owner"]);
    assert.equal(ownerRequests.get(1).status, "approved");
    assert.equal(auditLogs.at(-1).action, "owner_access.approved");

    const duplicateRequest = await fetch(`${baseUrl}/owner-access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({})
    });
    assert.equal(duplicateRequest.status, 409);

    const revoked = await fetch(`${baseUrl}/users/21/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ roles: ["farmer"] })
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(users.get(21).allowed_roles, ["farmer"]);
    assert.equal(ownerRequests.get(1).status, "revoked");
    assert.equal(auditLogs.at(-1).action, "user.owner_revoked");
});

test("request retries do not create duplicates while pending", async () => {
    users.set(22, {
        id: 22,
        name: "Another Farmer",
        email: "another@example.invalid",
        phone: null,
        role: "farmer",
        allowed_roles: ["farmer"],
        is_suspended: false,
        created_at: new Date().toISOString()
    });
    const token = jwt.sign({ id: 22, role: "pending", locationConfirmed: false }, process.env.JWT_SECRET);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${baseUrl}/owner-access-requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ note: `request ${attempt}` })
        });
        assert.equal(response.status, 201);
    }
    assert.equal(Array.from(ownerRequests.values()).filter(item => item.user_id === 22 && item.status === "pending").length, 1);

    const rejection = await fetch(`${baseUrl}/owner-requests/2/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reason: "Please provide additional details." })
    });
    assert.equal(rejection.status, 200);
    assert.equal(ownerRequests.get(2).status, "rejected");
    assert.deepEqual(users.get(22).allowed_roles, ["farmer"]);
    assert.equal(auditLogs.at(-1).action, "owner_access.rejected");
});

test("admin moderation actions update records and write audit entries", async () => {
    const suspended = await fetch(`${baseUrl}/users/22/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ suspended: true })
    });
    assert.equal(suspended.status, 200);
    assert.equal(users.get(22).is_suspended, true);
    assert.equal(auditLogs.at(-1).action, "user.suspended");

    const deactivated = await fetch(`${baseUrl}/machinery/30/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ active: false })
    });
    assert.equal(deactivated.status, 200);
    assert.equal(machinery.get(30).admin_active, false);
    assert.equal(auditLogs.at(-1).action, "machinery.deactivated");

    const cancelled = await fetch(`${baseUrl}/bookings/51/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: "cancelled", reason: "Duplicate booking confirmed." })
    });
    assert.equal(cancelled.status, 200);
    assert.equal(bookings.get(51).status, "cancelled");
    assert.equal(auditLogs.at(-1).action, "booking.cancelled_by_admin");
});

test("admin logout revokes the bearer token server-side", async () => {
    const logout = await fetch(`${baseUrl}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(logout.status, 200);
    assert.equal(auditLogs.at(-1).action, "admin.logged_out");
    const reused = await fetch(`${baseUrl}/session`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(reused.status, 401);
});
