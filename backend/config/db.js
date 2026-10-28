const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
    throw new Error("DATABASE_URL must be set in backend/.env to the Supabase PostgreSQL connection string.");
}

let parsedConnection;
try {
    parsedConnection = new URL(connectionString);
} catch {
    throw new Error("DATABASE_URL in backend/.env must be a valid PostgreSQL connection URL copied from Supabase.");
}
if (!["postgres:", "postgresql:"].includes(parsedConnection.protocol)) {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// protocol.");
}
if (!parsedConnection.username || !parsedConnection.password || connectionString.includes("[YOUR-PASSWORD]")) {
    throw new Error("DATABASE_URL must include your Supabase database username and password; replace [YOUR-PASSWORD] with the database password from your project.");
}

const isLocalDatabase = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsedConnection.hostname);
const sslEnabled = process.env.DATABASE_SSL?.toLowerCase() !== "false" && !isLocalDatabase;
const sslRejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED?.toLowerCase() !== "false";
const caPath = process.env.DATABASE_SSL_CA_PATH?.trim();
const ssl = sslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false;
if (sslEnabled && sslRejectUnauthorized && caPath) {
    const resolvedCaPath = path.isAbsolute(caPath) ? caPath : path.resolve(__dirname, "..", caPath);
    try {
        ssl.ca = fs.readFileSync(resolvedCaPath, "utf8");
    } catch {
        throw new Error(`Could not read the PostgreSQL CA certificate at ${resolvedCaPath}. Check DATABASE_SSL_CA_PATH.`);
    }
}
const pool = new Pool({
    connectionString,
    ssl,
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
