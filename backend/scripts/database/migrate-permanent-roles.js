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
    "make_roles_permanent.sql"
);

async function main() {
    try {
        const sql = fs.readFileSync(migrationPath, "utf8");
        await pool.query(sql);
        console.log("Permanent role migration applied successfully.");
    } catch (error) {
        console.error("Permanent role migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
