
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Import API routes
const pool = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const machineryRoutes = require("./routes/machineryRoutes");
const machineryOwnerRoutes = require("./routes/machineryOwnerRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const adminRoutes = require("./routes/adminRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

function isLocalDevelopmentOrigin(origin) {
    if (!origin || origin === "null") return true;
    try {
        const url = new URL(origin);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        const hostname = url.hostname;
        if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname)) return true;
        if (
            /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
            hostname.endsWith(".localhost") ||
            hostname.endsWith(".local")
        ) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

const configuredOrigins = new Set(
    (process.env.FRONTEND_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
);

// Middleware
app.use(cors({
    origin(origin, callback) {
        if (
            !origin ||
            origin === "null" ||
            configuredOrigins.has(origin) ||
            isLocalDevelopmentOrigin(origin)
        ) {
            return callback(null, true);
        }
        return callback(new Error("This frontend origin is not allowed by CORS."));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"]
}));
app.use(express.json({ limit: "6mb" }));
app.use("/api/auth", (req, res, next) => {
    const startedAt = Date.now();
    res.once("finish", () => {
        console.info("Authentication request completed:", {
            method: req.method,
            path: req.path,
            origin: req.get("origin") || "same-origin/no-origin",
            status: res.statusCode,
            durationMs: Date.now() - startedAt
        });
    });
    next();
});

// HOME
app.get("/", (req, res) => {
    res.json({
        message: "AgriMachConnect Backend is Running!",
        version: "1.0"
    });
});

async function healthCheck(req, res) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    try {
        const result = await pool.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [["users", "machinery", "bookings"]]
        );
        const availableTables = new Set(result.rows.map(row => row.table_name));
        const missingTables = ["users", "machinery", "bookings"]
            .filter(table => !availableTables.has(table));
        const databaseStatus = missingTables.length ? "schema_incomplete" : "connected";
        res.status(missingTables.length ? 503 : 200).json({
            status: missingTables.length ? "degraded" : "ok",
            server: "running",
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            database: {
                status: databaseStatus,
                missingTables
            }
        });
    } catch (error) {
        console.error("Health check could not reach PostgreSQL:", error.message);
        res.status(503).json({
            status: "degraded",
            server: "running",
            uptimeSeconds: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
            database: { status: "unavailable" },
            message: "Supabase PostgreSQL is unavailable. Verify DATABASE_URL and database access in backend/.env."
        });
    }
}

app.get("/api/health", healthCheck);
app.get("/health", healthCheck);

// API ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

// Farmer: view and search machinery
app.use("/api/machinery", machineryRoutes);

// Owner: add, view, update and deactivate own machinery
app.use("/api/machinery-owner", machineryOwnerRoutes);
app.use("/api/owner", machineryOwnerRoutes);

// Booking APIs
app.use("/api/bookings", bookingRoutes);

// Chat APIs
app.use("/api/chat", chatRoutes);

// Handle unknown API routes
app.use((req, res) => {
    res.status(404).json({
        message: "API route not found"
    });
});

// Error handler
app.use((err, req, res, next) => {
    const isCorsRejection = err.message === "This frontend origin is not allowed by CORS.";
    const responseStatus = isCorsRejection ? 403 : err.type === "entity.parse.failed" ? 400 : 500;
    console.error("Server request failed:", {
        category: isCorsRejection
            ? "cors"
            : err.type === "entity.parse.failed"
                ? "invalid_json"
                : "application",
        method: req.method,
        path: req.path,
        origin: req.get("origin") || "same-origin/no-origin",
        status: responseStatus,
        code: typeof err.code === "string" ? err.code : "unknown"
    });
    res.status(responseStatus).json({
        message: isCorsRejection
            ? "This frontend origin is not allowed by CORS. Add its full origin to FRONTEND_ORIGINS in backend/.env."
            : err.type === "entity.parse.failed"
                ? "Request body must contain valid JSON."
                : "Internal server error"
    });
});

// Start server
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

if (!process.env.JWT_SECRET?.trim()) {
    throw new Error("JWT_SECRET must be configured in backend/.env.");
}

async function startServer() {
    // Check if an instance of AgriMachConnect backend is already running on this port
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
            const data = await res.json();
            if (data.server === "running") {
                console.log("\n========================================================");
                console.log(`[INFO] AgriMachConnect backend is ALREADY RUNNING at http://127.0.0.1:${PORT}`);
                console.log(`API Health: http://127.0.0.1:${PORT}/api/health`);
                console.log("No duplicate server process was started.");
                console.log("========================================================\n");
                return;
            }
        }
    } catch {
        // Port is free or not responding to HTTP health check; proceed to listen
    }

    const server = app.listen(PORT, HOST, () => {
        console.log("\n========================================================");
        console.log(`AgriMachConnect server running at http://localhost:${PORT}`);
        console.log(`Bound to: ${HOST}:${PORT} (accessible via http://127.0.0.1:${PORT} and http://localhost:${PORT})`);
        console.log(`API Health: http://127.0.0.1:${PORT}/api/health`);
        console.log("========================================================\n");
        pool.query("SELECT 1")
            .then(() => console.log("Supabase PostgreSQL connected successfully"))
            .catch(error => {
                console.error(
                    "Supabase PostgreSQL is unavailable. Verify DATABASE_URL and database access in backend/.env:",
                    error.message
                );
            });
    });

    server.on("error", error => {
        if (error.code === "EADDRINUSE") {
            console.error(`\n[ERROR] Port ${PORT} is already in use by another process.`);
            console.error(`Stop the conflicting process or set another PORT in backend/.env.\n`);
        } else {
            console.error("Backend could not start:", error.message);
        }
        process.exitCode = 1;
    });

    function closeServer(signal) {
        console.log(`${signal} received; closing HTTP server and PostgreSQL pool.`);
        server.close(async closeError => {
            if (closeError) {
                console.error("Backend shutdown failed:", closeError.message);
                process.exitCode = 1;
            }
            try {
                await pool.end();
            } catch (error) {
                console.error("PostgreSQL pool shutdown failed:", error.message);
                process.exitCode = 1;
            }
        });
    }

    process.once("SIGINT", () => closeServer("SIGINT"));
    process.once("SIGTERM", () => closeServer("SIGTERM"));
}

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection detected:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception detected:", error);
});

startServer();
