const fs = require("fs");
const path = require("path");
const pool = require("./config/db");

const migrationPath = path.join(
    __dirname,
    "..",
    "database",
    "add_role_location_preferences.sql"
);

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Role and location migration applied successfully.");
    } catch (error) {
        console.error("Role and location migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
