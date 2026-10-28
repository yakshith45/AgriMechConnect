const assert = require("node:assert/strict");
const { test } = require("node:test");
const { updateAccountRoles } = require("./manage-account-roles");

function createDatabase(initialAccount) {
    const calls = [];
    const database = {
        async connect() {
            return {
                async query(sql, values = []) {
                    calls.push({ sql, values });
                    if (sql.includes("SELECT id, role, allowed_roles")) {
                        return { rows: initialAccount ? [{ ...initialAccount }] : [] };
                    }
                    if (sql.includes("UPDATE users")) {
                        return { rows: [{
                            id: values[2],
                            role: values[0],
                            allowed_roles: values[1]
                        }] };
                    }
                    return { rows: [] };
                },
                release() {
                    calls.push({ sql: "RELEASE" });
                }
            };
        }
    };
    return { database, calls };
}

test("authorized role setup enables both roles while preserving the current role", async () => {
    const { database, calls } = createDatabase({
        id: 10,
        role: "farmer",
        allowed_roles: ["farmer"]
    });

    const updated = await updateAccountRoles(database, " FARMER@example.com ", "farmer-and-owner");

    assert.deepEqual(updated, {
        id: 10,
        role: "farmer",
        allowed_roles: ["farmer", "owner"]
    });
    assert.equal(calls[1].values[0], "farmer@example.com");
    assert.deepEqual(calls[2].values, ["farmer", ["farmer", "owner"], 10]);
    assert.equal(calls.some(call => call.sql === "COMMIT"), true);
    assert.equal(calls.at(-1).sql, "RELEASE");
});

test("authorized role setup can provision a separate owner-only account", async () => {
    const { database, calls } = createDatabase({
        id: 11,
        role: "farmer",
        allowed_roles: ["farmer"]
    });

    const updated = await updateAccountRoles(database, "owner@example.com", "owner-only");

    assert.deepEqual(updated, { id: 11, role: "owner", allowed_roles: ["owner"] });
    assert.deepEqual(calls[2].values, ["owner", ["owner"], 11]);
});

test("role setup rolls back when the target account does not exist", async () => {
    const { database, calls } = createDatabase(null);

    await assert.rejects(
        updateAccountRoles(database, "missing@example.com", "farmer-and-owner"),
        /No account with that email address was found/
    );
    assert.equal(calls.some(call => call.sql === "ROLLBACK"), true);
    assert.equal(calls.some(call => call.sql === "COMMIT"), false);
});

test("role setup rejects invalid email and unapproved assignments", async () => {
    const { database, calls } = createDatabase(null);

    await assert.rejects(updateAccountRoles(database, "not-an-email", "owner-only"), /valid account email/);
    await assert.rejects(updateAccountRoles(database, "owner@example.com", "admin"), /Choose owner-only/);
    assert.equal(calls.length, 0);
});
