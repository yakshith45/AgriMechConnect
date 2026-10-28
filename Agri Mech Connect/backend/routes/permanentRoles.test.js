const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const pool = require("../config/db");

test("permanent user roles enforcement in database and authentication", async (t) => {
    const timestamp = Date.now();
    const farmerEmail = `perm_farmer_${timestamp}@example.invalid`;
    const ownerEmail = `perm_owner_${timestamp}@example.invalid`;
    let farmerId, ownerId;

    await t.test("can insert a Farmer account with permanent role in PostgreSQL", async () => {
        const res = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, allowed_roles)
             VALUES ($1, $2, $3, $4, $5, ARRAY[$5]::TEXT[])
             RETURNING id, role, allowed_roles`,
            ["Perm Farmer", farmerEmail, "9876543210", "dummyhash", "farmer"]
        );
        assert.equal(res.rows.length, 1);
        farmerId = res.rows[0].id;
        assert.equal(res.rows[0].role, "farmer");
        assert.deepEqual(res.rows[0].allowed_roles, ["farmer"]);
    });

    await t.test("can insert a Machinery Owner account with permanent role in PostgreSQL", async () => {
        const res = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, allowed_roles)
             VALUES ($1, $2, $3, $4, $5, ARRAY[$5]::TEXT[])
             RETURNING id, role, allowed_roles`,
            ["Perm Owner", ownerEmail, "9876543211", "dummyhash", "owner"]
        );
        assert.equal(res.rows.length, 1);
        ownerId = res.rows[0].id;
        assert.equal(res.rows[0].role, "owner");
        assert.deepEqual(res.rows[0].allowed_roles, ["owner"]);
    });

    await t.test("PostgreSQL trigger strictly blocks changing Farmer role to Owner", async () => {
        await assert.rejects(
            async () => {
                await pool.query("UPDATE users SET role = 'owner' WHERE id = $1", [farmerId]);
            },
            {
                message: /User roles are permanent and cannot be changed after registration/
            }
        );
        // Verify role remained unchanged
        const check = await pool.query("SELECT role FROM users WHERE id = $1", [farmerId]);
        assert.equal(check.rows[0].role, "farmer");
    });

    await t.test("PostgreSQL trigger strictly blocks changing Owner role to Farmer", async () => {
        await assert.rejects(
            async () => {
                await pool.query("UPDATE users SET role = 'farmer' WHERE id = $1", [ownerId]);
            },
            {
                message: /User roles are permanent and cannot be changed after registration/
            }
        );
        // Verify role remained unchanged
        const check = await pool.query("SELECT role FROM users WHERE id = $1", [ownerId]);
        assert.equal(check.rows[0].role, "owner");
    });

    await t.test("PostgreSQL allows profile and location updates while preserving role", async () => {
        const update = await pool.query(
            `UPDATE users
             SET selected_location = 'Sullia Center', selected_latitude = 12.561, selected_longitude = 75.387
             WHERE id = $1
             RETURNING id, role, allowed_roles, selected_location`,
            [farmerId]
        );
        assert.equal(update.rows[0].role, "farmer");
        assert.equal(update.rows[0].selected_location, "Sullia Center");
    });

    // Clean up test data
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [farmerId, ownerId]);
});

after(async () => {
    await pool.end();
});

