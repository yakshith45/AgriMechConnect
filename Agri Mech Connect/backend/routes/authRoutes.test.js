const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, before, test } = require("node:test");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
    SULLIA_CENTER,
    LOCATION_RADIUS_KM,
    distanceFromSulliaKm,
    isWithinLocationRadius
} = require("../config/location");

process.env.JWT_SECRET = "role-location-test-secret";

const users = new Map();
const machineryListings = new Map();
const bookings = new Map();
let nextBookingId = 1;
const databaseModulePath = require.resolve("../config/db");
const mockedDatabaseModule = new Module(databaseModulePath);
mockedDatabaseModule.filename = databaseModulePath;
mockedDatabaseModule.loaded = true;
mockedDatabaseModule.exports = {
    async query(sql, values = []) {
        if (sql.includes("SELECT * FROM users WHERE LOWER(email) = $1")) {
            const user = Array.from(users.values()).find(item => item.email.toLowerCase() === values[0]);
            return { rows: user ? [{ ...user }] : [] };
        }
        if (sql.includes("SELECT * FROM users WHERE email = $1")) {
            const user = Array.from(users.values()).find(item => item.email === values[0]);
            return { rows: user ? [{ ...user }] : [] };
        }
        if (sql.includes("INSERT INTO users (")) {
            const [name, email, phone, password, role, location, latitude, longitude] = values;
            const user = {
                id: users.size + 1,
                name,
                email,
                phone,
                password,
                role,
                allowed_roles: [role],
                farm_location: location,
                farm_latitude: latitude,
                farm_longitude: longitude,
                selected_location: location,
                selected_latitude: latitude,
                selected_longitude: longitude
            };
            users.set(user.id, user);
            const publicUser = { ...user };
            delete publicUser.password;
            return { rows: [publicUser] };
        }
        if (sql.includes("SELECT role, allowed_roles, is_suspended FROM users WHERE id = $1")) {
            const user = users.get(Number(values[0]));
            return {
                rows: user ? [{
                    role: user.role,
                    allowed_roles: user.allowed_roles,
                    is_suspended: user.is_suspended || false
                }] : []
            };
        }
        if (sql.includes("FROM bookings b") && sql.includes("WHERE m.owner_id = $1")) {
            return {
                rows: Array.from(bookings.values())
                    .filter(item => Number(machineryListings.get(item.machinery_id)?.owner_id) === Number(values[0]))
                    .map(item => ({
                        ...item,
                        machinery_name: machineryListings.get(item.machinery_id)?.name,
                        machinery_type: machineryListings.get(item.machinery_id)?.type,
                        farmer_name: users.get(Number(item.farmer_id))?.name,
                        farmer_phone: users.get(Number(item.farmer_id))?.phone,
                        farmer_email: users.get(Number(item.farmer_id))?.email,
                        farmer_location: users.get(Number(item.farmer_id))?.selected_location ||
                            users.get(Number(item.farmer_id))?.farm_location,
                        farmer_latitude: users.get(Number(item.farmer_id))?.selected_latitude ||
                            users.get(Number(item.farmer_id))?.farm_latitude,
                        farmer_longitude: users.get(Number(item.farmer_id))?.selected_longitude ||
                            users.get(Number(item.farmer_id))?.farm_longitude
                    }))
            };
        }
        if (sql.includes("SELECT role, allowed_roles FROM users WHERE id = $1")) {
            const user = users.get(Number(values[0]));
            return { rows: user ? [{ role: user.role, allowed_roles: user.allowed_roles }] : [] };
        }
        if (sql.includes("FROM users") && sql.includes("WHERE id = $1")) {
            const user = users.get(Number(values[0]));
            return {
                rows: user ? [{
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    allowed_roles: user.allowed_roles,
                    selected_location: user.selected_location,
                    selected_latitude: user.selected_latitude,
                    selected_longitude: user.selected_longitude,
                    farm_location: user.farm_location,
                    farm_latitude: user.farm_latitude,
                    farm_longitude: user.farm_longitude,
                    is_suspended: user.is_suspended || false
                }] : []
            };
        }
        if (sql.includes("UPDATE users") && sql.includes("selected_location = ")) {
            let id, location, latitude, longitude;
            if (sql.includes("selected_location = $2")) {
                [id, location, latitude, longitude] = values;
            } else {
                let role;
                [id, role, location, latitude, longitude] = values;
            }
            const user = users.get(Number(id));
            if (!user) return { rows: [] };
            user.selected_location = location;
            user.selected_latitude = latitude;
            user.selected_longitude = longitude;
            if (user.role === "farmer") {
                user.farm_location = location;
                user.farm_latitude = latitude;
                user.farm_longitude = longitude;
            }
            return { rows: [{ ...user }] };
        }
        if (sql.includes("UPDATE users SET role = $2")) {
            const [id, role] = values;
            const user = users.get(Number(id));
            if (!user || !user.allowed_roles.includes(role) || user.is_suspended) return { rows: [] };
            user.role = role;
            return { rows: [{ ...user }] };
        }
        if (sql.includes("SELECT allowed_roles FROM users WHERE id = $1")) {
            const user = users.get(Number(values[0]));
            return { rows: user ? [{ allowed_roles: user.allowed_roles }] : [] };
        }
        if (sql.includes("SELECT selected_latitude, selected_longitude")) {
            const user = users.get(Number(values[0]));
            return {
                rows: user ? [{
                    selected_latitude: user.selected_latitude,
                    selected_longitude: user.selected_longitude
                }] : []
            };
        }
        if (sql.includes("INSERT INTO machinery")) {
            const [
                ownerId, name, type, brand, model, description, price,
                priceUnit, specifications, location, latitude, longitude,
                imageUrl, availability, availabilityStartDate, availabilityEndDate,
                availabilityStartTime, availabilityEndTime
            ] = values;
            const listing = {
                id: machineryListings.size + 1,
                owner_id: ownerId,
                name,
                type,
                brand,
                model,
                description,
                price,
                price_unit: priceUnit,
                specifications: JSON.parse(specifications),
                location,
                latitude,
                longitude,
                image_url: imageUrl,
                availability,
                admin_active: true,
                availability_start_date: availabilityStartDate,
                availability_end_date: availabilityEndDate,
                availability_start_time: availabilityStartTime,
                availability_end_time: availabilityEndTime
            };
            machineryListings.set(listing.id, listing);
            return { rows: [{ ...listing }] };
        }
        if (sql.includes("SELECT * FROM machinery") && sql.includes("owner_id = $1")) {
            return {
                rows: Array.from(machineryListings.values()).filter(item => item.owner_id === values[0])
            };
        }
        if (sql.includes("UPDATE machinery") && sql.includes("SET availability = FALSE")) {
            const [id, ownerId] = values;
            const listing = machineryListings.get(Number(id));
            if (!listing || listing.owner_id !== ownerId) return { rows: [] };
            listing.availability = false;
            return { rows: [{ id: listing.id }] };
        }
        if (sql.includes("UPDATE machinery") && sql.includes("availability_start_date = CASE")) {
            const [name, type, brand, model, description, price, priceUnit, specifications,
                location, latitude, longitude, imageUrl, availability,
                hasStartDate, startDate, hasEndDate, endDate,
                hasStartTime, startTime, hasEndTime, endTime, id, ownerId] = values;
            const listing = machineryListings.get(Number(id));
            if (!listing || listing.owner_id !== ownerId) return { rows: [] };
            for (const [key, value] of Object.entries({
                name, type, brand, model, description, price,
                price_unit: priceUnit, location, latitude, longitude,
                image_url: imageUrl, availability
            })) if (value !== null) listing[key] = value;
            if (specifications !== null) listing.specifications = JSON.parse(specifications);
            if (hasStartDate) listing.availability_start_date = startDate;
            if (hasEndDate) listing.availability_end_date = endDate;
            if (hasStartTime) listing.availability_start_time = startTime;
            if (hasEndTime) listing.availability_end_time = endTime;
            return { rows: [{ ...listing }] };
        }
        if (sql.includes("FROM bookings b") && sql.includes("WHERE b.farmer_id = $1")) {
            return {
                rows: Array.from(bookings.values())
                    .filter(item => item.farmer_id === values[0])
                    .map(item => ({
                        ...item,
                        cancellation_deadline: new Date(Date.parse(item.created_at) + 6 * 60 * 60 * 1000).toISOString(),
                        cancellation_allowed: Date.now() - Date.parse(item.created_at) < 6 * 60 * 60 * 1000,
                        machinery_name: machineryListings.get(item.machinery_id)?.name,
                        machinery_type: machineryListings.get(item.machinery_id)?.type,
                        owner_name: users.get(Number(machineryListings.get(item.machinery_id)?.owner_id))?.name,
                        owner_phone: users.get(Number(machineryListings.get(item.machinery_id)?.owner_id))?.phone
                    }))
            };
        }
        if (sql.includes("FROM bookings b") && sql.includes("WHERE m.owner_id = $1")) {
            return {
                rows: Array.from(bookings.values())
                    .filter(item => machineryListings.get(item.machinery_id)?.owner_id === values[0])
                    .map(item => ({
                        ...item,
                        machinery_name: machineryListings.get(item.machinery_id)?.name,
                        farmer_name: users.get(Number(item.farmer_id))?.name,
                        farmer_phone: users.get(Number(item.farmer_id))?.phone,
                        farmer_email: users.get(Number(item.farmer_id))?.email,
                        farmer_location: users.get(Number(item.farmer_id))?.selected_location ||
                            users.get(Number(item.farmer_id))?.farm_location,
                        farmer_latitude: users.get(Number(item.farmer_id))?.selected_latitude ||
                            users.get(Number(item.farmer_id))?.farm_latitude,
                        farmer_longitude: users.get(Number(item.farmer_id))?.selected_longitude ||
                            users.get(Number(item.farmer_id))?.farm_longitude
                    }))
            };
        }
        if (sql.includes("WITH nearby AS")) {
            const [latitude, longitude, radius, category, matchingTypes, minPrice, maxPrice, date, start, end, tankCapacity,
                availabilityDate, availabilityStart, availabilityEnd, horsepowerRange, horsepowerMinimum, horsepowerMaximum,
                approvedTypes, noAvailabilityRestrictions] = values;
            const rows = [];
            for (const listing of machineryListings.values()) {
                if (!listing.availability || listing.latitude == null || listing.longitude == null) continue;
                const distance = distanceFromSulliaKm(Number(listing.latitude), Number(listing.longitude));
                if (distanceFromSulliaKm(latitude, longitude) > LOCATION_RADIUS_KM || distance > radius) continue;
                if (minPrice != null && Number(listing.price) < minPrice) continue;
                if (maxPrice != null && Number(listing.price) > maxPrice) continue;
                if (availabilityDate && listing.availability_start_date && availabilityDate < listing.availability_start_date) continue;
                if (availabilityDate && listing.availability_end_date && availabilityDate > listing.availability_end_date) continue;
                if (availabilityStart && listing.availability_start_time && availabilityStart < listing.availability_start_time) continue;
                if (availabilityEnd && listing.availability_end_time && availabilityEnd > listing.availability_end_time) continue;
                if (noAvailabilityRestrictions && [
                    listing.availability_start_date,
                    listing.availability_end_date,
                    listing.availability_start_time,
                    listing.availability_end_time
                ].some(value => value != null)) continue;
                if (horsepowerRange) {
                    const horsepower = Number(listing.specifications?.horsepower_hp);
                    if (!Number.isFinite(horsepower) || horsepower < horsepowerMinimum || (horsepowerMaximum != null && horsepower > horsepowerMaximum)) continue;
                }
                const type = String(listing.type).trim().toLowerCase();
                if (!approvedTypes.includes(type)) continue;
                if (category && !matchingTypes.includes(type)) continue;
                if (tankCapacity && !["25", "25 l", "25 litre", "25 litres", "25 liter", "25 liters"].includes(String(listing.specifications?.tank_capacity_l || "").trim().toLowerCase())) continue;
                if (date && Array.from(bookings.values()).some(booking =>
                    booking.machinery_id === listing.id &&
                    booking.booking_date === date &&
                    ["pending", "accepted"].includes(booking.status) &&
                    booking.start_time < end &&
                    booking.end_time > start
                )) continue;
                const owner = users.get(Number(listing.owner_id));
                rows.push({ ...listing, owner_name: owner?.name, owner_phone: owner?.phone, distance_km: distance });
            }
            return { rows };
        }
        throw new Error(`Unexpected test query: ${sql}`);
    },
    async connect() {
        return {
            async query(sql, values = []) {
                if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
                if (sql.includes("SELECT id, availability")) {
                    const listing = machineryListings.get(Number(values[0]));
                    return { rows: listing ? [{
                        id: listing.id,
                        availability: listing.availability,
                        admin_active: listing.admin_active !== false,
                        price: listing.price,
                        price_unit: listing.price_unit,
                        availability_start_date: listing.availability_start_date,
                        availability_end_date: listing.availability_end_date,
                        availability_start_time: listing.availability_start_time,
                        availability_end_time: listing.availability_end_time
                    }] : [] };
                }
                if (sql.includes("SELECT id") && sql.includes("FROM bookings") && sql.includes("start_time < $4::TIME")) {
                    const [machineId, date, start, end] = values;
                    const conflicts = Array.from(bookings.values()).filter(item =>
                        item.machinery_id === Number(machineId) &&
                        item.booking_date === date &&
                        ["pending", "accepted"].includes(item.status) &&
                        item.start_time < end &&
                        item.end_time > start
                    );
                    return { rows: conflicts.slice(0, 1).map(item => ({ id: item.id })) };
                }
                if (sql.includes("INSERT INTO bookings")) {
                    const [farmerId, machineId, date, start, end, rentalRate, rentalUnit, estimatedTotal] = values;
                    const booking = {
                        id: nextBookingId++,
                        farmer_id: farmerId,
                        machinery_id: Number(machineId),
                        booking_date: date,
                        start_time: start,
                        end_time: end,
                        rental_rate: rentalRate,
                        rental_unit: rentalUnit,
                        estimated_total: estimatedTotal,
                        created_at: new Date().toISOString(),
                        status: "pending"
                    };
                    bookings.set(booking.id, booking);
                    return { rows: [{ ...booking }] };
                }
                if (sql.includes("SELECT b.*, m.owner_id")) {
                    const booking = bookings.get(Number(values[0]));
                    const listing = booking && machineryListings.get(booking.machinery_id);
                    return { rows: booking && listing ? [{
                        ...booking,
                        owner_id: listing.owner_id,
                        availability: listing.availability,
                        availability_start_date: listing.availability_start_date,
                        availability_end_date: listing.availability_end_date,
                        availability_start_time: listing.availability_start_time,
                        availability_end_time: listing.availability_end_time,
                        cancellation_allowed: Date.now() - Date.parse(booking.created_at) < 6 * 60 * 60 * 1000
                    }] : [] };
                }
                if (sql.includes("SELECT machinery_id")) {
                    const booking = bookings.get(Number(values[0]));
                    return { rows: booking ? [{ machinery_id: booking.machinery_id }] : [] };
                }
                if (sql.includes("SELECT id") && sql.includes("FROM machinery") && sql.includes("FOR UPDATE")) {
                    const listing = machineryListings.get(Number(values[0]));
                    return { rows: listing ? [{ id: listing.id }] : [] };
                }
                if (sql.includes("AND status = 'accepted'")) {
                    const [machineId, bookingId, date, start, end] = values;
                    const conflicts = Array.from(bookings.values()).filter(item =>
                        item.machinery_id === Number(machineId) &&
                        item.id !== Number(bookingId) &&
                        item.booking_date === date &&
                        item.status === "accepted" &&
                        item.start_time < end &&
                        item.end_time > start
                    );
                    return { rows: conflicts.slice(0, 1).map(item => ({ id: item.id })) };
                }
                if (sql.includes("UPDATE bookings")) {
                    const [status, id] = values;
                    const booking = bookings.get(Number(id));
                    if (!booking) return { rows: [] };
                    booking.status = status;
                    return { rows: [{ ...booking }] };
                }
                throw new Error(`Unexpected transaction query: ${sql}`);
            },
            release() {}
        };
    }
};
require.cache[databaseModulePath] = mockedDatabaseModule;

const authRoutes = require("./authRoutes");
const machineryOwnerRoutes = require("./machineryOwnerRoutes");
const machineryRoutes = require("./machineryRoutes");
const bookingRoutes = require("./bookingRoutes");
const { authenticateToken, requireRole } = require("../middleware/authMiddleware");
const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/machinery-owner", machineryOwnerRoutes);
app.use("/api/machinery", machineryRoutes);
app.use("/api/bookings", bookingRoutes);
app.get("/test/owner", authenticateToken, requireRole("owner"), (req, res) => {
    res.json({ role: req.user.role });
});
app.get("/test/farmer", authenticateToken, requireRole("farmer"), (req, res) => {
    res.json({ role: req.user.role });
});

let server;
let baseUrl;
let singleRoleToken;
let singleRoleActiveToken;
let dualRoleToken;
let dualRoleActiveToken;

before(async () => {
    const passwordHash = await bcrypt.hash("test-password", 4);
    users.set(1, {
        id: 1,
        name: "Single Role Test",
        email: "farmer-test@example.invalid",
        phone: "9876543210",
        password: passwordHash,
        role: "farmer",
        allowed_roles: ["farmer"],
        farm_location: null,
        farm_latitude: null,
        farm_longitude: null,
        selected_location: null,
        selected_latitude: null,
        selected_longitude: null
    });
    users.set(2, {
        id: 2,
        name: "Dual Role Test",
        email: "dual-test@example.invalid",
        phone: "9876543211",
        password: passwordHash,
        role: "farmer",
        allowed_roles: ["farmer", "owner"],
        farm_location: null,
        farm_latitude: null,
        farm_longitude: null,
        selected_location: null,
        selected_latitude: null,
        selected_longitude: null
    });
    server = await new Promise(resolve => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
});

test("location settings use the Sullia center and configured radius", async () => {
    const response = await fetch(`${baseUrl}/api/auth/location-config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        center: SULLIA_CENTER,
        radiusKm: LOCATION_RADIUS_KM
    });
    assert.equal(isWithinLocationRadius(SULLIA_CENTER.latitude, SULLIA_CENTER.longitude), true);
    assert.equal(
        isWithinLocationRadius(SULLIA_CENTER.latitude, SULLIA_CENTER.longitude + 0.4),
        false
    );
    assert.ok(distanceFromSulliaKm(
        SULLIA_CENTER.latitude,
        SULLIA_CENTER.longitude + 0.4
    ) > LOCATION_RADIUS_KM);
});

test("registration creates one account, supports login, and rejects duplicates", async () => {
    const account = {
        name: "Registration Test",
        email: "registration-test@example.invalid",
        phone: "9876543212",
        password: "registration-password",
        role: "farmer"
    };
    const invalidRoleRegistration = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...account, email: "invalid-role@example.invalid", role: "admin" })
    });
    assert.equal(invalidRoleRegistration.status, 400);

    const ownerRegistration = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...account, email: "owner-registration@example.invalid", role: "owner" })
    });
    assert.equal(ownerRegistration.status, 201);
    const registeredOwner = await ownerRegistration.json();
    assert.equal(registeredOwner.user.role, "owner");

    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account)
    });
    assert.equal(response.status, 201);
    const registered = await response.json();
    assert.equal(registered.message, "Registration successful");
    assert.equal(registered.user.role, "farmer");
    assert.deepEqual(registered.user.allowed_roles, ["farmer"]);
    assert.equal("password" in registered.user, false);
    const registrationClaims = jwt.verify(registered.token, process.env.JWT_SECRET);
    assert.equal(registrationClaims.role, "farmer");
    assert.deepEqual(registrationClaims.permittedRoles, ["farmer"]);
    assert.notEqual(users.get(registered.user.id).password, account.password);

    const missingCredentials = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "", password: "" })
    });
    assert.equal(missingCredentials.status, 400);
    assert.equal((await missingCredentials.json()).message, "Email and password are required.");

    const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account)
    });
    assert.equal(duplicate.status, 400);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password: account.password })
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.email, account.email);
});

test("login issues a session with persisted role permissions", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "farmer-test@example.invalid",
            password: "test-password"
        })
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.user.role, "farmer");
    assert.deepEqual(data.user.permitted_roles, ["farmer"]);
    const loginClaims = jwt.verify(data.token, process.env.JWT_SECRET);
    assert.equal(loginClaims.role, "farmer");
    assert.deepEqual(loginClaims.permittedRoles, ["farmer"]);
    singleRoleToken = data.token;

    const protectedResponse = await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${singleRoleToken}` }
    });
    assert.equal(protectedResponse.status, 403);
    assert.deepEqual(await protectedResponse.json(), {
        code: "ROLE_LOCATION_REQUIRED",
        message: "Confirm your role and location before using this service."
    });
});

test("owner-only accounts receive Owner permission in login and confirmed tokens", async () => {
    const passwordHash = await bcrypt.hash("test-password", 4);
    users.set(4, {
        id: 4,
        name: "Owner Only Test",
        email: "owner-only-test@example.invalid",
        phone: "9876543213",
        password: passwordHash,
        role: "owner",
        allowed_roles: ["owner"],
        farm_location: null,
        farm_latitude: null,
        farm_longitude: null,
        selected_location: null,
        selected_latitude: null,
        selected_longitude: null
    });

    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "owner-only-test@example.invalid",
            password: "test-password"
        })
    });
    assert.equal(response.status, 200);
    const login = await response.json();
    assert.deepEqual(login.user.permitted_roles, ["owner"]);
    assert.deepEqual(jwt.verify(login.token, process.env.JWT_SECRET).permittedRoles, ["owner"]);

    const confirmation = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`
        },
        body: JSON.stringify({
            role: "owner",
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(confirmation.status, 200);
    const confirmed = await confirmation.json();
    assert.deepEqual(jwt.verify(confirmed.token, process.env.JWT_SECRET).permittedRoles, ["owner"]);
    assert.equal((await fetch(`${baseUrl}/test/owner`, {
        headers: { Authorization: `Bearer ${confirmed.token}` }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${confirmed.token}` }
    })).status, 403);

    const directOwnerWithLocation = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`
        },
        body: JSON.stringify({ role: "owner" })
    });
    assert.equal(directOwnerWithLocation.status, 200);
    const directOwnerSession = await directOwnerWithLocation.json();
    assert.equal(directOwnerSession.user.role, "owner");
    assert.equal(jwt.verify(directOwnerSession.token, process.env.JWT_SECRET).locationConfirmed, true);
    assert.equal((await fetch(`${baseUrl}/test/owner`, {
        headers: { Authorization: `Bearer ${directOwnerSession.token}` }
    })).status, 200);
});

test("permanent role login isolates dashboards and owner bookings are ownership-scoped", async () => {
    Object.assign(users.get(2), {
        role: "owner",
        allowed_roles: ["owner"],
        selected_location: "Sullia",
        selected_latitude: SULLIA_CENTER.latitude,
        selected_longitude: SULLIA_CENTER.longitude
    });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dual-test@example.invalid", password: "test-password" })
    });
    assert.equal(login.status, 200);
    const loginData = await login.json();
    assert.equal(loginData.user.role, "owner");

    // Attempting to switch role to farmer is rejected
    const selectFarmer = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({ role: "farmer" })
    });
    assert.equal(selectFarmer.status, 403);

    // Confirming own permanent role succeeds
    const selectOwner = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({ role: "owner" })
    });
    assert.equal(selectOwner.status, 200);
    const ownerSession = await selectOwner.json();
    assert.equal(ownerSession.user.role, "owner");
    assert.equal((await fetch(`${baseUrl}/test/owner`, {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
    })).status, 403);

    machineryListings.set(50, {
        id: 50,
        owner_id: 2,
        name: "Dual owner tractor",
        type: "Tractor",
        availability: true,
        admin_active: true
    });
    machineryListings.set(51, {
        id: 51,
        owner_id: 1,
        name: "Different owner's tractor",
        type: "Tractor",
        availability: true,
        admin_active: true
    });
    bookings.set(50, {
        id: 50,
        farmer_id: 1,
        machinery_id: 50,
        status: "pending",
        booking_date: "2027-01-01",
        start_time: "08:00",
        end_time: "09:00"
    });
    bookings.set(51, {
        id: 51,
        farmer_id: 1,
        machinery_id: 51,
        status: "pending",
        booking_date: "2027-01-01",
        start_time: "08:00",
        end_time: "09:00"
    });

    const ownerBookings = await fetch(`${baseUrl}/api/bookings/owner`, {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
    });
    assert.equal(ownerBookings.status, 200);
    const ownedBookings = await ownerBookings.json();
    assert.deepEqual(ownedBookings.map(booking => booking.id), [50]);

    machineryListings.delete(50);
    machineryListings.delete(51);
    bookings.delete(50);
    bookings.delete(51);
});

test("a Farmer account cannot select Owner even when requesting the role directly", async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "farmer-test@example.invalid", password: "test-password" })
    });
    const loginData = await login.json();
    const denied = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({ role: "owner" })
    });
    assert.equal(denied.status, 403);
    assert.equal(users.get(1).role, "farmer");
});

test("an Owner account cannot select Farmer even when requesting the role directly", async () => {
    const owner = users.get(4);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: owner.email, password: "test-password" })
    });
    assert.equal(login.status, 200);
    const loginData = await login.json();
    assert.equal(loginData.user.role, "owner");

    const denied = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({ role: "farmer" })
    });
    assert.equal(denied.status, 403);
    assert.equal(owner.role, "owner");
});

test("role selection requires an existing in-radius location before issuing an active session", async () => {
    const passwordHash = await bcrypt.hash("test-password", 4);
    users.set(5, {
        id: 5,
        name: "Owner Without Location",
        email: "owner-no-location@example.invalid",
        phone: null,
        password: passwordHash,
        role: "owner",
        allowed_roles: ["owner"],
        farm_location: null,
        farm_latitude: null,
        farm_longitude: null,
        selected_location: null,
        selected_latitude: null,
        selected_longitude: null
    });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner-no-location@example.invalid", password: "test-password" })
    });
    const loginData = await login.json();
    const selection = await fetch(`${baseUrl}/api/auth/select-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.token}` },
        body: JSON.stringify({ role: "owner" })
    });
    assert.equal(selection.status, 409);
    assert.equal((await selection.json()).code, "LOCATION_CONFIRMATION_REQUIRED");
    users.delete(5);
});

test("the server rejects out-of-radius and unpermitted role selections without saving", async () => {
    const outOfRadius = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleToken}`
        },
        body: JSON.stringify({
            role: "farmer",
            location: "Outside area",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude + 0.4
        })
    });
    assert.equal(outOfRadius.status, 400);
    assert.equal(users.get(1).selected_location, null);

    const forbiddenRole = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleToken}`
        },
        body: JSON.stringify({
            role: "owner",
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(forbiddenRole.status, 403);
    assert.equal(users.get(1).role, "farmer");
    assert.equal(users.get(1).selected_location, null);
});

test("a permitted role can confirm location, use protected APIs, and reload its saved selection", async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "dual-test@example.invalid",
            password: "test-password"
        })
    });
    assert.equal(loginResponse.status, 200);
    dualRoleToken = (await loginResponse.json()).token;

    const confirmation = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleToken}`
        },
        body: JSON.stringify({
            role: "owner",
            location: "Sullia, Dakshina Kannada, Karnataka",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(confirmation.status, 200);
    const session = await confirmation.json();
    assert.equal(session.user.role, "owner");
    assert.equal(session.user.selected_location, "Sullia, Dakshina Kannada, Karnataka");
    assert.equal(session.user.selected_latitude, SULLIA_CENTER.latitude);
    assert.equal(session.user.selected_longitude, SULLIA_CENTER.longitude);
    const confirmedClaims = jwt.verify(session.token, process.env.JWT_SECRET);
    assert.equal(confirmedClaims.locationConfirmed, true);
    assert.deepEqual(confirmedClaims.permittedRoles, ["owner"]);
    assert.equal(users.get(2).role, "owner");
    assert.equal(users.get(2).selected_location, "Sullia, Dakshina Kannada, Karnataka");
    assert.equal(users.get(2).selected_latitude, SULLIA_CENTER.latitude);
    assert.equal(users.get(2).selected_longitude, SULLIA_CENTER.longitude);
    dualRoleActiveToken = session.token;

    const ownerResponse = await fetch(`${baseUrl}/test/owner`, {
        headers: { Authorization: `Bearer ${session.token}` }
    });
    assert.equal(ownerResponse.status, 200);
    assert.deepEqual(await ownerResponse.json(), { role: "owner" });
    const farmerOnOwnerSession = await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${dualRoleActiveToken}` }
    });
    assert.equal(farmerOnOwnerSession.status, 403);

    const staleRoleToken = jwt.sign(
        { id: 2, role: "farmer", locationConfirmed: true },
        process.env.JWT_SECRET
    );
    const staleRoleResponse = await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${staleRoleToken}` }
    });
    assert.equal(staleRoleResponse.status, 403);

    const nextLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "dual-test@example.invalid",
            password: "test-password"
        })
    });
    const nextLoginData = await nextLogin.json();
    const savedUser = nextLoginData.user;
    assert.equal(savedUser.role, "owner");
    assert.deepEqual(savedUser.permitted_roles, ["owner"]);
    assert.deepEqual(jwt.verify(nextLoginData.token, process.env.JWT_SECRET).permittedRoles, ["owner"]);
    assert.equal(savedUser.selected_location, "Sullia, Dakshina Kannada, Karnataka");
    assert.equal(savedUser.selected_latitude, SULLIA_CENTER.latitude);

    // Attempting to change permanent role from owner to farmer is rejected
    const invalidFarmerSwitch = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${nextLoginData.token}`
        },
        body: JSON.stringify({
            role: "farmer",
            location: "Sullia Farm",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(invalidFarmerSwitch.status, 403);

    // Updating location for owner role succeeds
    const ownerSession = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${nextLoginData.token}`
        },
        body: JSON.stringify({
            role: "owner",
            location: "Sullia Owner",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(ownerSession.status, 200);
    dualRoleActiveToken = (await ownerSession.json()).token;
    assert.equal((await fetch(`${baseUrl}/test/owner`, {
        headers: { Authorization: `Bearer ${dualRoleActiveToken}` }
    })).status, 200);
    assert.equal((await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${dualRoleActiveToken}` }
    })).status, 403);
});

test("owner listings and nearby searches enforce the Sullia service radius", async () => {
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dualRoleActiveToken}`
    };
    const listing = {
        name: "Test Tractor",
        type: "Tractor",
        brand: "Test Brand",
        model: "T-35",
        description: "Owner-entered test description",
        specifications: { horsepower_hp: 35, tractor_type: "Utility", condition: "Good working condition" },
        image_url: "data:image/png;base64,iVBORw0KGgo=",
        price: 1000,
        location: "Sullia",
        latitude: SULLIA_CENTER.latitude,
        longitude: SULLIA_CENTER.longitude,
        availability_start_time: "08:00",
        availability_end_time: "17:00",
        availability_start_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        availability_end_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10)
    };
    const outsideListing = await fetch(`${baseUrl}/api/machinery-owner`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            ...listing,
            longitude: SULLIA_CENTER.longitude + 0.4
        })
    });
    assert.equal(outsideListing.status, 400);
    assert.equal(machineryListings.size, 0);

    for (const latitude of [[], " "]) {
        const invalidCoordinates = await fetch(`${baseUrl}/api/machinery-owner`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...listing, latitude })
        });
        assert.equal(invalidCoordinates.status, 400);
        assert.equal(machineryListings.size, 0);
    }

    const created = await fetch(`${baseUrl}/api/machinery-owner`, {
        method: "POST",
        headers,
        body: JSON.stringify(listing)
    });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.equal(createdPayload.machinery.location, listing.location);
    assert.equal(createdPayload.machinery.latitude, listing.latitude);
    assert.equal(createdPayload.machinery.longitude, listing.longitude);
    assert.equal(createdPayload.machinery.image_url, listing.image_url);
    assert.equal(createdPayload.machinery.specifications.condition, "Good working condition");
    assert.equal(machineryListings.size, 1);
    assert.equal(machineryListings.get(1).image_url, listing.image_url);
    assert.equal(machineryListings.get(1).specifications.horsepower_hp, 35);
    assert.equal(machineryListings.get(1).location, listing.location);
    assert.equal(machineryListings.get(1).latitude, listing.latitude);
    assert.equal(machineryListings.get(1).longitude, listing.longitude);
    const ownerListings = await fetch(`${baseUrl}/api/machinery-owner`, {
        headers: { Authorization: `Bearer ${dualRoleActiveToken}` }
    });
    assert.equal(ownerListings.status, 200);
    const savedListings = await ownerListings.json();
    assert.equal(savedListings[0].image_url, listing.image_url);
    assert.equal(savedListings[0].location, listing.location);
    assert.equal(savedListings[0].latitude, listing.latitude);
    assert.equal(savedListings[0].longitude, listing.longitude);

    const ownerEdit = await fetch(`${baseUrl}/api/machinery-owner/1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ description: "Owner-edited description" })
    });
    assert.equal(ownerEdit.status, 200);
    assert.equal((await ownerEdit.json()).machinery.description, "Owner-edited description");
    assert.equal(machineryListings.get(1).image_url, listing.image_url);

    const markUnavailable = await fetch(`${baseUrl}/api/machinery-owner/1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ availability: false })
    });
    assert.equal(markUnavailable.status, 200);
    assert.equal(machineryListings.get(1).availability, false);
    const markAvailable = await fetch(`${baseUrl}/api/machinery-owner/1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ availability: true })
    });
    assert.equal(markAvailable.status, 200);
    assert.equal(machineryListings.get(1).availability, true);

    const legacyOwnerId = jwt.verify(dualRoleActiveToken, process.env.JWT_SECRET).id;
    const legacyListing = {
        id: 90,
        owner_id: legacyOwnerId,
        name: "Historical sprayer",
        type: "Sprayer Machine",
        price: 100,
        price_unit: "day",
        specifications: { tank_capacity_l: 25 },
        location: "Sullia",
        latitude: SULLIA_CENTER.latitude,
        longitude: SULLIA_CENTER.longitude,
        availability: true
    };
    machineryListings.set(legacyListing.id, legacyListing);
    const legacyEdit = await fetch(`${baseUrl}/api/machinery-owner/90`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ description: "Preserved legacy listing" })
    });
    assert.equal(legacyEdit.status, 200);
    assert.equal(machineryListings.get(90).type, "Sprayer Machine");
    assert.deepEqual(machineryListings.get(90).specifications, { tank_capacity_l: 25 });
    const legacyDeactivation = await fetch(`${baseUrl}/api/machinery-owner/90`, {
        method: "DELETE",
        headers
    });
    assert.equal(legacyDeactivation.status, 200);
    assert.equal(machineryListings.get(90).availability, false);
    assert.equal(machineryListings.get(90).type, "Sprayer Machine");

    const outsideUpdate = await fetch(`${baseUrl}/api/machinery-owner/1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ longitude: SULLIA_CENTER.longitude + 0.4 })
    });
    assert.equal(outsideUpdate.status, 400);
    assert.equal(machineryListings.get(1).longitude, SULLIA_CENTER.longitude);

    const outsideSearch = await fetch(
        `${baseUrl}/api/machinery?latitude=0&longitude=0&radius=25`
    );
    assert.equal(outsideSearch.status, 401);
});

test("marketplace search and booking flow use saved coordinates and enforce overlap and ownership", async () => {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: "farmer-test@example.invalid",
            password: "test-password"
        })
    });
    singleRoleToken = (await loginResponse.json()).token;
    const confirmation = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleToken}`
        },
        body: JSON.stringify({
            role: "farmer",
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(confirmation.status, 200);
    singleRoleActiveToken = (await confirmation.json()).token;

    const farmerAccount = users.get(1);
    const refreshedSession = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal(refreshedSession.status, 200);
    const refreshedData = await refreshedSession.json();
    assert.deepEqual(refreshedData.user.permitted_roles, ["farmer"]);
    assert.equal(refreshedData.user.role, "farmer");
    const refreshedClaims = jwt.verify(refreshedData.token, process.env.JWT_SECRET);
    assert.equal(refreshedClaims.role, "farmer");
    assert.deepEqual(refreshedClaims.permittedRoles, ["farmer"]);

    // Attempting to change role to owner is rejected
    const ownerSelection = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({
            role: "owner",
            location: "Sullia Owner",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(ownerSelection.status, 403);

    // Confirming location for own permanent farmer role succeeds
    const farmerSelection = await fetch(`${baseUrl}/api/auth/confirm-location`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({
            role: "farmer",
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(farmerSelection.status, 200);
    const farmerSessionData = await farmerSelection.json();
    assert.equal(farmerSessionData.user.role, "farmer");
    singleRoleActiveToken = farmerSessionData.token;
    assert.equal((await fetch(`${baseUrl}/test/farmer`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    })).status, 200);

    const search = await fetch(`${baseUrl}/api/machinery?radius=5&category=tractor`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal(search.status, 200);
    const listedMachinery = await search.json();
    assert.equal(listedMachinery.length, 1);
    assert.equal(listedMachinery[0].name, "Test Tractor");
    assert.equal(listedMachinery[0].owner_name, "Dual Role Test");
    assert.equal(listedMachinery[0].location, "Sullia");
    assert.equal(listedMachinery[0].latitude, SULLIA_CENTER.latitude);
    assert.equal(listedMachinery[0].longitude, SULLIA_CENTER.longitude);
    assert.equal(listedMachinery[0].distance_km, 0);
    assert.equal(listedMachinery[0].image_url, "data:image/png;base64,iVBORw0KGgo=");
    assert.equal(listedMachinery[0].description, "Owner-edited description");
    assert.equal(listedMachinery[0].specifications.condition, "Good working condition");
    assert.equal(listedMachinery[0].brand, "Test Brand");
    assert.equal(listedMachinery[0].model, "T-35");

    const tractorPowerSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=tractor&horsepower_range=31-40`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal(tractorPowerSearch.status, 200);
    assert.equal((await tractorPowerSearch.json()).length, 1);
    const wrongPowerSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=tractor&horsepower_range=41-50`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal((await wrongPowerSearch.json()).length, 0);

    for (const type of ["All Machinery", "Sprayer Machine", "Other Machinery", "Other Agricultural Machinery"]) {
        const rejectedCategory = await fetch(`${baseUrl}/api/machinery-owner`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${dualRoleActiveToken}`
            },
            body: JSON.stringify({
                name: `Rejected ${type}`,
                type,
                price: 100,
                location: "Sullia",
                latitude: SULLIA_CENTER.latitude,
                longitude: SULLIA_CENTER.longitude
            })
        });
        assert.equal(rejectedCategory.status, 400);
    }

    for (const [name, type] of [
        ["Test Rotavator", "Tiller / Rotavator"],
        ["Test Power Tiller", "Power Tiller"],
        ["Test Harvester", "Harvester"],
        ["Test Agricultural Drone", "Agricultural Drone"],
        ["Test Trailer", "Trailer"]
    ]) {
        const createdCategory = await fetch(`${baseUrl}/api/machinery-owner`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${dualRoleActiveToken}`
            },
            body: JSON.stringify({
                name,
                type,
                price: 300,
                location: "Sullia",
                latitude: SULLIA_CENTER.latitude,
                longitude: SULLIA_CENTER.longitude
            })
        });
        assert.equal(createdCategory.status, 201);
    }

    const powerTillerSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=power-tiller`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.deepEqual((await powerTillerSearch.json()).map(item => item.type), ["Power Tiller"]);
    const rotavatorSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=rotavator`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.deepEqual((await rotavatorSearch.json()).map(item => item.type), ["Tiller / Rotavator"]);
    const removedCategorySearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=sprayer`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal(removedCategorySearch.status, 400);
    const legacyAvailableListing = {
        id: 91,
        owner_id: jwt.verify(dualRoleActiveToken, process.env.JWT_SECRET).id,
        name: "Legacy available sprayer",
        type: "Sprayer Machine",
        price: 100,
        location: "Sullia",
        latitude: SULLIA_CENTER.latitude,
        longitude: SULLIA_CENTER.longitude,
        availability: true
    };
    machineryListings.set(legacyAvailableListing.id, legacyAvailableListing);
    const allSupportedSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=all`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    const supportedTypes = (await allSupportedSearch.json()).map(item => item.type).sort();
    assert.deepEqual(supportedTypes, [
        "Harvester",
        "Power Tiller",
        "Tiller / Rotavator",
        "Tractor",
        "Trailer",
        "Agricultural Drone"
    ].sort());
    assert.equal(machineryListings.get(legacyAvailableListing.id).type, "Sprayer Machine");

    const sprayer = await fetch(`${baseUrl}/api/machinery-owner`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({
            name: "Test Sprayer",
            type: "Adike (Arecanut) Sprayer",
            price: 400,
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude,
            specifications: { tank_capacity_l: "25" }
        })
    });
    assert.equal(sprayer.status, 201);
    const allCategoriesSearch = await fetch(`${baseUrl}/api/machinery?radius=5&category=all`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.deepEqual(
        new Set((await allCategoriesSearch.json()).map(item => item.type)),
        new Set([
            "Tractor",
            "Harvester",
            "Tiller / Rotavator",
            "Power Tiller",
            "Adike (Arecanut) Sprayer",
            "Agricultural Drone",
            "Trailer"
        ])
    );
    const capacitySearch = await fetch(
        `${baseUrl}/api/machinery?radius=5&category=adike-sprayer&tank_capacity_l=25`,
        { headers: { Authorization: `Bearer ${singleRoleActiveToken}` } }
    );
    assert.equal(capacitySearch.status, 200);
    assert.equal((await capacitySearch.json())[0].specifications.tank_capacity_l, "25");
    const unrestrictedAvailabilitySearch = await fetch(
        `${baseUrl}/api/machinery?radius=5&category=adike-sprayer&availability_mode=no_restrictions`,
        { headers: { Authorization: `Bearer ${singleRoleActiveToken}` } }
    );
    assert.equal(unrestrictedAvailabilitySearch.status, 200);
    assert.equal((await unrestrictedAvailabilitySearch.json()).length, 1);

    const invalidCapacityFilter = await fetch(
        `${baseUrl}/api/machinery?radius=5&category=tractor&tank_capacity_l=25`,
        { headers: { Authorization: `Bearer ${singleRoleActiveToken}` } }
    );
    assert.equal(invalidCapacityFilter.status, 400);
    const invalidAvailabilityFilter = await fetch(
        `${baseUrl}/api/machinery?radius=5&availability_mode=unavailable`,
        { headers: { Authorization: `Bearer ${singleRoleActiveToken}` } }
    );
    assert.equal(invalidAvailabilityFilter.status, 400);

    const bookingDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const bookingPayload = {
        machinery_id: listedMachinery[0].id,
        booking_date: bookingDate,
        start_time: "08:00",
        end_time: "11:00"
    };
    const outsideOwnerHours = await fetch(`${baseUrl}/api/bookings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({ ...bookingPayload, start_time: "18:00", end_time: "19:00" })
    });
    assert.equal(outsideOwnerHours.status, 409);
    const createdBooking = await fetch(`${baseUrl}/api/bookings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify(bookingPayload)
    });
    assert.equal(createdBooking.status, 201);
    const { booking } = await createdBooking.json();
    assert.equal(booking.status, "pending");
    assert.equal(booking.rental_rate, 1000);
    assert.equal(booking.rental_unit, "day");
    assert.equal(booking.estimated_total, 1000);
    assert.ok(booking.created_at);

    const hourlyListing = await fetch(`${baseUrl}/api/machinery-owner`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({
            name: "Hourly Drone",
            type: "Agricultural Drone",
            price: 200,
            price_unit: "hour",
            specifications: { payload_capacity_kg: 10, tank_capacity_l: 5 },
            location: "Sullia",
            latitude: SULLIA_CENTER.latitude,
            longitude: SULLIA_CENTER.longitude
        })
    });
    assert.equal(hourlyListing.status, 201);
    const hourlyMachine = (await hourlyListing.json()).machinery;
    assert.equal(hourlyMachine.specifications.payload_capacity_kg, 10);
    assert.equal(hourlyMachine.specifications.tank_capacity_l, 5);
    const hourlyBookingResponse = await fetch(`${baseUrl}/api/bookings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({
            machinery_id: hourlyMachine.id,
            booking_date: bookingDate,
            start_time: "08:00",
            end_time: "11:00"
        })
    });
    assert.equal(hourlyBookingResponse.status, 201);
    const hourlyBooking = await hourlyBookingResponse.json();
    assert.equal(hourlyBooking.booking.estimated_total, 600);

    const overlappingBooking = await fetch(`${baseUrl}/api/bookings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify(bookingPayload)
    });
    assert.equal(overlappingBooking.status, 409);

    const ownerRequests = await fetch(`${baseUrl}/api/bookings/owner`, {
        headers: { Authorization: `Bearer ${dualRoleActiveToken}` }
    });
    assert.equal(ownerRequests.status, 200);
    const ownerBookings = await ownerRequests.json();
    assert.equal(ownerBookings.length, 2);
    assert.equal(ownerBookings[0].farmer_email, "farmer-test@example.invalid");
    assert.equal(ownerBookings[0].farmer_location, "Sullia");
    assert.equal(ownerBookings[0].farmer_latitude, SULLIA_CENTER.latitude);
    assert.equal(ownerBookings[0].farmer_longitude, SULLIA_CENTER.longitude);

    const existingAccepted = { ...booking, id: 9000, status: "accepted" };
    bookings.set(existingAccepted.id, existingAccepted);
    const overlappingAcceptance = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({ status: "accepted" })
    });
    assert.equal(overlappingAcceptance.status, 409);
    bookings.delete(existingAccepted.id);

    const accepted = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({ status: "accepted" })
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).message, "Booking Successfully Accepted");

    const rejected = await fetch(`${baseUrl}/api/bookings/${hourlyBooking.booking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({ status: "rejected" })
    });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).booking.status, "rejected");

    const farmerBookings = await fetch(`${baseUrl}/api/bookings/farmer`, {
        headers: { Authorization: `Bearer ${singleRoleActiveToken}` }
    });
    assert.equal(farmerBookings.status, 200);
    const farmerBookingItems = await farmerBookings.json();
    assert.equal(farmerBookingItems[0].status, "accepted");
    assert.equal(farmerBookingItems[0].cancellation_allowed, true);
    assert.ok(farmerBookingItems[0].cancellation_deadline);

    const farmerCancellation = await fetch(`${baseUrl}/api/bookings/${booking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(farmerCancellation.status, 200);
    assert.equal((await farmerCancellation.json()).booking.status, "cancelled");

    const releasedSlotBooking = await fetch(`${baseUrl}/api/bookings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify(bookingPayload)
    });
    assert.equal(releasedSlotBooking.status, 201);
    const expiredBooking = (await releasedSlotBooking.json()).booking;
    bookings.get(expiredBooking.id).created_at = new Date(Date.now() - 6 * 60 * 60 * 1000 - 1000).toISOString();

    const expiredCancellation = await fetch(`${baseUrl}/api/bookings/${expiredBooking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(expiredCancellation.status, 409);

    const acceptedAfterExpiry = await fetch(`${baseUrl}/api/bookings/${expiredBooking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({ status: "accepted" })
    });
    assert.equal(acceptedAfterExpiry.status, 200);
    const completed = await fetch(`${baseUrl}/api/bookings/${expiredBooking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${dualRoleActiveToken}`
        },
        body: JSON.stringify({ status: "completed" })
    });
    assert.equal(completed.status, 200);
    const completedCancellation = await fetch(`${baseUrl}/api/bookings/${expiredBooking.id}/status`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${singleRoleActiveToken}`
        },
        body: JSON.stringify({ status: "cancelled" })
    });
    assert.equal(completedCancellation.status, 409);
});
