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
    "add_chat_system.sql"
);

async function main() {
    try {
        const sql = fs.readFileSync(migrationPath, "utf8");
        await pool.query(sql);
        console.log("Chat system migration applied successfully.");
    } catch (error) {
        console.error("Chat system migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
