const assert = require("node:assert/strict");
const { test } = require("node:test");
const bcrypt = require("bcrypt");
const { provisionAdmin, provisionAdminFromEnvironment, isLocalDatabaseHost } = require("./provision-admin");

test("admin provisioning normalizes email and stores only a bcrypt hash", async () => {
    let inserted;
    const database = {
        async query(sql, values) {
            assert.match(sql, /INSERT INTO admin_accounts/);
            inserted = values;
            return {
                rows: [{
                    id: 41,
                    name: values[0],
                    email: values[1],
                    is_active: true,
                    created_at: new Date().toISOString()
                }]
            };
        }
    };
    const result = await provisionAdmin(database, "  Admin Person  ", " Admin@Example.Invalid ", "long-test-password");
    assert.deepEqual([result.name, result.email], ["Admin Person", "admin@example.invalid"]);
    assert.equal(inserted[2] === "long-test-password", false);
    assert.equal(await bcrypt.compare("long-test-password", inserted[2]), true);
});

test("admin provisioning rejects invalid inputs before writing to the database", async () => {
    let writes = 0;
    const database = { async query() { writes += 1; return { rows: [] }; } };
    await assert.rejects(() => provisionAdmin(database, "", "admin@example.invalid", "long-test-password"));
    await assert.rejects(() => provisionAdmin(database, "Admin", "bad-email", "long-test-password"));
    await assert.rejects(() => provisionAdmin(database, "Admin", "admin@example.invalid", "short"));
    assert.equal(writes, 0);
});

test("environment provisioning accepts only development with a loopback database host", async () => {
    assert.equal(isLocalDatabaseHost("localhost"), true);
    assert.equal(isLocalDatabaseHost("127.0.0.1"), true);
    assert.equal(isLocalDatabaseHost("::1"), true);
    assert.equal(isLocalDatabaseHost("db.example.invalid"), false);

    let queries = 0;
    const database = { async query() { queries += 1; return { rows: [] }; } };
    const credentials = {
        NODE_ENV: "development",
        DB_HOST: "localhost",
        ADMIN_BOOTSTRAP_NAME: "Admin",
        ADMIN_BOOTSTRAP_EMAIL: "admin@example.invalid",
        ADMIN_BOOTSTRAP_PASSWORD: "long-enough-secret"
    };
    await assert.rejects(
        () => provisionAdminFromEnvironment(database, { ...credentials, NODE_ENV: "production" }),
        /only when NODE_ENV=development/
    );
    await assert.rejects(
        () => provisionAdminFromEnvironment(database, { ...credentials, DB_HOST: "remote.example.invalid" }),
        /local PostgreSQL host/
    );
    await assert.rejects(
        () => provisionAdminFromEnvironment(database, { ...credentials, ADMIN_BOOTSTRAP_PASSWORD: "" }),
        /Set ADMIN_BOOTSTRAP_NAME/
    );
    await assert.rejects(
        () => provisionAdminFromEnvironment(database, { ...credentials, ADMIN_BOOTSTRAP_PASSWORD: "short" }),
        /at least 12 characters/
    );
    assert.equal(queries, 0);
});

test("environment provisioning hashes password and refuses to change an existing Admin", async () => {
    const inserted = [];
    let existing = false;
    const database = {
        async query(sql, values) {
            if (sql.includes("SELECT id FROM admin_accounts")) {
                return { rows: existing ? [{ id: 9 }] : [] };
            }
            assert.match(sql, /INSERT INTO admin_accounts/);
            inserted.push(values);
            return { rows: [{ id: 12, name: values[0], email: values[1] }] };
        }
    };
    const credentials = {
        NODE_ENV: "development",
        DB_HOST: "127.0.0.1",
        ADMIN_BOOTSTRAP_NAME: "Local Admin",
        ADMIN_BOOTSTRAP_EMAIL: " ADMIN@Example.Invalid ",
        ADMIN_BOOTSTRAP_PASSWORD: "local-admin-password"
    };
    const result = await provisionAdminFromEnvironment(database, credentials);
    assert.deepEqual([result.name, result.email], ["Local Admin", "admin@example.invalid"]);
    assert.equal(await bcrypt.compare(credentials.ADMIN_BOOTSTRAP_PASSWORD, inserted[0][2]), true);

    existing = true;
    await assert.rejects(
        () => provisionAdminFromEnvironment(database, credentials),
        /already exists\. No account was changed/
    );
    assert.equal(inserted.length, 1);
});
