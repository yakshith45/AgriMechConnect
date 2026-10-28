const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const requiredVariables = ["DB_USER", "DB_HOST", "DB_NAME", "DB_PASSWORD"];
const missingVariables = requiredVariables.filter(name => !process.env[name]?.trim());
if (missingVariables.length) {
    throw new Error(`Missing required backend environment variables: ${missingVariables.join(", ")}.`);
}

const databasePort = Number(process.env.DB_PORT || 5432);
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error("DB_PORT in backend/.env must be a valid TCP port from 1 to 65535.");
}

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: databasePort,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    keepAlive: true
});

pool.on("error", error => {
    console.error("Unexpected PostgreSQL pool error:", {
        code: typeof error.code === "string" ? error.code : "unknown",
        message: "The PostgreSQL connection pool emitted an error."
    });
});

module.exports = pool;