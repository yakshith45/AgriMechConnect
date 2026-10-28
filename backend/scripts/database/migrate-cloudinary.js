const fs = require("node:fs");
const path = require("node:path");
const pool = require("../../config/db");

const migrationPath = path.join(__dirname, "..", "..", "..", "database", "migrations", "add_cloudinary_image_storage.sql");

async function main() {
    try {
        await pool.query(fs.readFileSync(migrationPath, "utf8"));
        console.log("Cloudinary image metadata migration applied successfully.");
    } catch (error) {
        console.error("Cloudinary image metadata migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) main();
