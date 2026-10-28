const readline = require("node:readline");
const bcrypt = require("bcrypt");

function readHidden(promptText) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || typeof input.setRawMode !== "function") {
            reject(new Error("Admin provisioning requires an interactive terminal for hidden password entry."));
            return;
        }

        let value = "";
        const cleanup = () => {
            input.removeListener("data", onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write("\n");
        };
        const onData = chunk => {
            for (const character of chunk) {
                if (character === "\u0003") {
                    cleanup();
                    reject(new Error("Admin provisioning cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    cleanup();
                    resolve(value);
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    value = value.slice(0, -1);
                } else if (character >= " ") {
                    value += character;
                }
            }
        };

        process.stdout.write(promptText);
        input.setRawMode(true);
        input.setEncoding("utf8");
        input.resume();
        input.on("data", onData);
    });
}

async function provisionAdmin(database, name, email, password) {
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalizedName || normalizedName.length > 120) {
        throw new Error("Enter an admin name of 1–120 characters.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("Enter a valid admin email address.");
    }
    if (typeof password !== "string" || password.length < 12) {
        throw new Error("Admin password must be at least 12 characters.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await database.query(
        `INSERT INTO admin_accounts (name, email, password)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, is_active, created_at`,
        [normalizedName, normalizedEmail, passwordHash]
    );
    return result.rows[0];
}

function isLocalDatabaseHost(host) {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        typeof host === "string" ? host.trim().toLowerCase() : ""
    );
}

async function provisionAdminFromEnvironment(database, environment) {
    if (environment.NODE_ENV !== "development") {
        throw new Error("Environment-based Admin provisioning is allowed only when NODE_ENV=development.");
    }
    if (!isLocalDatabaseHost(environment.DB_HOST)) {
        throw new Error("Environment-based Admin provisioning requires a local PostgreSQL host.");
    }
    const name = environment.ADMIN_BOOTSTRAP_NAME;
    const email = environment.ADMIN_BOOTSTRAP_EMAIL;
    const password = environment.ADMIN_BOOTSTRAP_PASSWORD;
    if (![name, email, password].every(value => typeof value === "string" && value.trim())) {
        throw new Error("Set ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_EMAIL, and ADMIN_BOOTSTRAP_PASSWORD for this command.");
    }
    if (password.length < 12) {
        throw new Error("Admin password must be at least 12 characters.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await database.query(
        "SELECT id FROM admin_accounts WHERE email = $1",
        [normalizedEmail]
    );
    if (existing.rows.length) {
        throw new Error("An Admin account with this email already exists. No account was changed.");
    }
    return provisionAdmin(database, name, normalizedEmail, password);
}

async function main() {
    const pool = require("./config/db");
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const name = await prompt.question("Admin name: ");
        const email = await prompt.question("Admin email: ");
        prompt.close();
        const password = await readHidden("Admin password (hidden, minimum 12 characters): ");
        const confirmation = await readHidden("Confirm admin password: ");
        if (password !== confirmation) {
            throw new Error("The passwords do not match.");
        }
        const admin = await provisionAdmin(pool, name, email, password);
        console.log(`Admin account provisioned: ${admin.email} (ID ${admin.id}).`);
    } catch (error) {
        console.error("Admin provisioning failed:", error.message);
        process.exitCode = 1;
    } finally {
        if (!prompt.closed) prompt.close();
        await pool.end();
    }
}

async function mainFromEnvironment() {
    const path = require("path");
    require("dotenv").config({ path: path.join(__dirname, ".env") });
    const credentials = {
        NODE_ENV: process.env.NODE_ENV,
        DB_HOST: process.env.DB_HOST,
        ADMIN_BOOTSTRAP_NAME: process.env.ADMIN_BOOTSTRAP_NAME,
        ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL,
        ADMIN_BOOTSTRAP_PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD
    };
    delete process.env.ADMIN_BOOTSTRAP_NAME;
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;

    const pool = require("./config/db");
    try {
        const admin = await provisionAdminFromEnvironment(pool, credentials);
        console.log(`Admin account provisioned: ${admin.email} (ID ${admin.id}).`);
    } catch (error) {
        console.error("Admin provisioning failed:", error.message);
        process.exitCode = 1;
    } finally {
        credentials.ADMIN_BOOTSTRAP_PASSWORD = "";
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { provisionAdmin, provisionAdminFromEnvironment, isLocalDatabaseHost, mainFromEnvironment };
