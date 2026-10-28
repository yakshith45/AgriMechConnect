const fs = require("fs");
const path = require("path");
const pool = require("../../config/db");

const migrationPath = path.join(__dirname, "..", "..", "..", "database", "migrations", "add_admin_dashboard.sql");

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Admin dashboard migration applied successfully.");
    } catch (error) {
        console.error("Admin dashboard migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}
