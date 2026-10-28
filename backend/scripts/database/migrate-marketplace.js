const fs = require("fs");
const path = require("path");
const pool = require("../../config/db");

const migrationPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "database",
    "migrations",
    "add_machinery_marketplace_fields.sql"
);

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Machinery marketplace migration applied successfully.");
    } catch (error) {
        console.error("Machinery marketplace migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
