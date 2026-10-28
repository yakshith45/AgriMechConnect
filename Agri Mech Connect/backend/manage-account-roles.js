const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const pool = require("./config/db");

const ROLE_ASSIGNMENTS = new Set(["owner-only", "farmer-and-owner"]);

async function updateAccountRoles(database, email, assignment) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Enter a valid account email address.");
    }
    if (!ROLE_ASSIGNMENTS.has(assignment)) {
        throw new Error("Choose owner-only or farmer-and-owner.");
    }

    const client = await database.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const accountResult = await client.query(
            `SELECT id, role, allowed_roles
             FROM users
             WHERE LOWER(email) = $1
             FOR UPDATE`,
            [normalizedEmail]
        );
        if (!accountResult.rows.length) {
            throw new Error("No account with that email address was found.");
        }

        const account = accountResult.rows[0];
        const role = assignment === "owner-only" ? "owner" : account.role;
        const allowedRoles = assignment === "owner-only"
            ? ["owner"]
            : Array.from(new Set([
                ...(Array.isArray(account.allowed_roles) ? account.allowed_roles : []),
                "farmer",
                "owner"
            ]));
        const updateResult = await client.query(
            `UPDATE users
             SET role = $1, allowed_roles = $2::TEXT[]
             WHERE id = $3
             RETURNING id, role, allowed_roles`,
            [role, allowedRoles, account.id]
        );

        await client.query("COMMIT");
        transactionOpen = false;
        return updateResult.rows[0];
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Account role update rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const prompt = readline.createInterface({ input: stdin, output: stdout });
    try {
        console.log("Authorized account role setup (uses the configured PostgreSQL credentials).");
        console.log("Register the account first; this command never creates, deletes, or changes passwords.");
        const email = await prompt.question("Account email: ");
        console.log("1. Owner only (use for a separate owner account)");
        console.log("2. Farmer and Owner (enable both roles on one account)");
        const choice = await prompt.question("Choose 1 or 2: ");
        const assignment = choice.trim() === "1"
            ? "owner-only"
            : choice.trim() === "2"
                ? "farmer-and-owner"
                : "";
        if (!assignment) {
            throw new Error("Choose 1 or 2.");
        }
        const confirmation = await prompt.question(
            `Apply ${assignment} permissions to ${email.trim().toLowerCase()}? Type YES to confirm: `
        );
        if (confirmation.trim() !== "YES") {
            console.log("No account changes were made.");
            return;
        }
        const account = await updateAccountRoles(pool, email, assignment);
        console.log("Account permissions updated. The role-selection page will refresh permissions; sign in again if the running backend cannot refresh sessions.");
        console.log(`Current role: ${account.role}; authorized roles: ${account.allowed_roles.join(", ")}`);
    } catch (error) {
        console.error("Account role setup failed:", error.message);
        process.exitCode = 1;
    } finally {
        prompt.close();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { updateAccountRoles };
