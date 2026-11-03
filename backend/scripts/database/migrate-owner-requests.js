const fs = require("fs");
const path = require("path");
const pool = require("../../config/db");

const migrationPath = path.join(__dirname, "..", "..", "..", "database", "migrations", "add_owner_requests_case_support.sql");

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Owner access requests status migration applied successfully.");
    } catch (error) {
        console.error("Owner access requests migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
