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
    "add_booking_availability_fields.sql"
);

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Booking availability migration applied successfully.");
    } catch (error) {
        console.error("Booking availability migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();