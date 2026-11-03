const express = require("express");
const pool = require("../config/db");
const { isWithinLocationRadius, LOCATION_RADIUS_KM } = require("../config/location");
const { authenticateToken, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();
const ALLOWED_RADII = [5, 10, 25];
const HORSEPOWER_RANGES = {
    "20-30": [20, 30],
    "31-40": [31, 40],
    "41-50": [41, 50],
    "above-50": [51, null]
};
const CATEGORY_TYPES = {
    tractor: ["tractor"],
    harvester: ["harvester"],
    rotavator: ["tiller / rotavator"],
    "power-tiller": ["power tiller"],
    "adike-sprayer": ["adike (arecanut) sprayer"],
    drone: ["agricultural drone"],
    trailer: ["trailer"]
};
const CATEGORIES = Object.keys(CATEGORY_TYPES);
const APPROVED_CATEGORY_TYPES = Object.values(CATEGORY_TYPES).flat();

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value &&
        value >= new Date().toISOString().slice(0, 10);
}

function isValidTime(value) {
    return typeof value === "string" &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseOptionalPrice(value, label) {
    if (value == null || value === "") return { value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${label} must be a non-negative number.` };
    }
    return { value: parsed };
}

function categoryTypes(category) {
    return CATEGORY_TYPES[category] || [];
}

// GET /api/machinery?radius=25&category=tractor&booking_date=YYYY-MM-DD&start_time=08:00&end_time=17:00
router.get("/", authenticateToken, requireRole("farmer"), async (req, res) => {
    try {
        const radius = Number(req.query.radius ?? 25);
        if (!ALLOWED_RADII.includes(radius)) {
            return res.status(400).json({ message: "Choose a search radius of 5, 10, or 25 km." });
        }

        const accountResult = await pool.query(
            `SELECT selected_latitude, selected_longitude
             FROM users
             WHERE id = $1`,
            [req.user.id]
        );
        if (!accountResult.rows.length) {
            return res.status(401).json({ message: "Your account could not be found. Please log in again." });
        }
        const latitude = Number(accountResult.rows[0].selected_latitude);
        const longitude = Number(accountResult.rows[0].selected_longitude);
        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !isWithinLocationRadius(latitude, longitude)
        ) {
            return res.status(400).json({
                message: `Confirm a location within ${LOCATION_RADIUS_KM} km of Sullia before searching.`
            });
        }

        const category = req.query.category == null || req.query.category === "all"
            ? null
            : String(req.query.category).toLowerCase();
        if (category && !CATEGORIES.includes(category)) {
            return res.status(400).json({ message: "Choose a valid machinery category." });
        }

        const minPrice = parseOptionalPrice(req.query.minPrice, "Minimum price");
        const maxPrice = parseOptionalPrice(req.query.maxPrice, "Maximum price");
        if (minPrice.error || maxPrice.error) {
            return res.status(400).json({ message: minPrice.error || maxPrice.error });
        }
        if (minPrice.value !== null && maxPrice.value !== null && minPrice.value > maxPrice.value) {
            return res.status(400).json({ message: "Minimum price cannot exceed maximum price." });
        }

        const tankCapacity = req.query.tank_capacity_l == null || req.query.tank_capacity_l === ""
            ? null
            : String(req.query.tank_capacity_l);
        if (tankCapacity !== null && (tankCapacity !== "25" || category !== "adike-sprayer")) {
            return res.status(400).json({
                message: "The 25-litre capacity filter is available for Adike (Arecanut) Sprayers only."
            });
        }

        const horsepowerRange = req.query.horsepower_range == null || req.query.horsepower_range === ""
            ? null
            : String(req.query.horsepower_range);
        if (horsepowerRange !== null && (!HORSEPOWER_RANGES[horsepowerRange] || category !== "tractor")) {
            return res.status(400).json({ message: "Choose a valid tractor horsepower range." });
        }

        const availabilityMode = req.query.availability_mode == null || req.query.availability_mode === ""
            ? "any"
            : String(req.query.availability_mode);
        if (!["any", "no_restrictions"].includes(availabilityMode)) {
            return res.status(400).json({ message: "Choose a valid machinery availability filter." });
        }

        const bookingDate = req.query.booking_date || null;
        const startTime = req.query.start_time || null;
        const endTime = req.query.end_time || null;
        if (
            (bookingDate || startTime || endTime) &&
            (!bookingDate || !startTime || !endTime ||
                !isValidDate(bookingDate) ||
                !isValidTime(startTime) ||
                !isValidTime(endTime) ||
                endTime <= startTime)
        ) {
            return res.status(400).json({
                message: "Choose a valid future booking date and a start and end time."
            });
        }

        const matchingTypes = category ? categoryTypes(category) : null;
        let diagnosticResult = { rows: [] };
        let diagnosticListingsResult = { rows: [] };
        try {
            [diagnosticResult, diagnosticListingsResult] = await Promise.all([
                pool.query(
                `SELECT
                    COUNT(*)::INT AS total_count,
                    COUNT(*) FILTER (
                        WHERE COALESCE(admin_active, TRUE) = TRUE
                    )::INT AS published_count,
                    COUNT(*) FILTER (
                        WHERE availability = TRUE
                          AND COALESCE(admin_active, TRUE) = TRUE
                    )::INT AS published_available_count
                 FROM machinery`
                ),
                pool.query(
                `SELECT
                    m.id, m.name, m.type, m.owner_id, m.availability, m.admin_active,
                    m.latitude, m.longitude,
                    m.availability_start_date, m.availability_end_date,
                    m.availability_start_time, m.availability_end_time,
                    (
                        6371 * 2 * ASIN(SQRT(LEAST(1, GREATEST(0,
                            POWER(SIN(RADIANS(m.latitude - $1) / 2), 2) +
                            COS(RADIANS($1)) * COS(RADIANS(m.latitude)) *
                            POWER(SIN(RADIANS(m.longitude - $2) / 2), 2)
                        ))))
                    ) AS distance_km,
                    EXISTS (
                        SELECT 1
                        FROM bookings b
                        WHERE b.machinery_id = m.id
                          AND b.booking_date = $3::DATE
                          AND b.status IN ('pending', 'accepted')
                          AND b.start_time < $5::TIME
                          AND b.end_time > $4::TIME
                    ) AS has_booking_conflict
                 FROM machinery m
                 ORDER BY m.created_at DESC
                 LIMIT 100`,
                [latitude, longitude, bookingDate, startTime, endTime]
                )
            ]);
        } catch (error) {
            console.warn("Machinery search diagnostics unavailable:", error.message);
        }
        const diagnostics = diagnosticResult.rows[0] || {};
        const exclusionReasons = diagnosticListingsResult.rows.map(listing => {
            const reasons = [];
            const normalizedType = String(listing.type || "").trim().toLowerCase();
            const hasCoordinates = listing.latitude != null && listing.longitude != null;
            const distance = Number(listing.distance_km);
            if (listing.availability !== true) reasons.push("unavailable");
            if (listing.admin_active === false) reasons.push("admin_inactive");
            if (!hasCoordinates) reasons.push("missing_coordinates");
            if (hasCoordinates && (!Number.isFinite(distance) || distance > radius)) reasons.push("outside_radius");
            if (!APPROVED_CATEGORY_TYPES.includes(normalizedType)) reasons.push("unsupported_category");
            if (category && !matchingTypes.includes(normalizedType)) reasons.push("category_filter");
            if (bookingDate && listing.availability_start_date &&
                bookingDate < String(listing.availability_start_date).slice(0, 10)) reasons.push("before_owner_date_window");
            if (bookingDate && listing.availability_end_date &&
                bookingDate > String(listing.availability_end_date).slice(0, 10)) reasons.push("after_owner_date_window");
            if (startTime && listing.availability_start_time &&
                startTime < String(listing.availability_start_time).slice(0, 5)) reasons.push("before_owner_time_window");
            if (endTime && listing.availability_end_time &&
                endTime > String(listing.availability_end_time).slice(0, 5)) reasons.push("after_owner_time_window");
            if (availabilityMode === "no_restrictions" && [
                listing.availability_start_date,
                listing.availability_end_date,
                listing.availability_start_time,
                listing.availability_end_time
            ].some(Boolean)) reasons.push("owner_restrictions_requested_off");
            if (listing.has_booking_conflict) reasons.push("booking_conflict");
            return {
                id: listing.id,
                name: listing.name,
                type: listing.type,
                ownerId: listing.owner_id,
                latitude: listing.latitude,
                longitude: listing.longitude,
                distanceKm: distance,
                reasons
            };
        });
        console.info("Machinery search diagnostics:", {
            farmerId: req.user.id,
            farmerCoordinates: { latitude, longitude },
            totalMachineryRecords: diagnostics.total_count,
            publishedListings: diagnostics.published_count,
            publishedAvailableListings: diagnostics.published_available_count,
            radiusKm: radius,
            category: category || "all",
            bookingDate,
            startTime,
            endTime,
            listings: exclusionReasons
        });
        const result = await pool.query(
            `WITH nearby AS (
                SELECT
                    m.id, m.owner_id, m.name, m.type, m.brand, m.model,
                    m.description, m.price, m.price_unit, m.specifications,
                    m.location, m.latitude, m.longitude, m.image_url,
                    m.availability, m.availability_start_date, m.availability_end_date,
                    m.availability_start_time, m.availability_end_time, m.created_at,
                    u.name AS owner_name,
                    u.phone AS owner_phone,
                    (
                        6371 * 2 * ASIN(SQRT(LEAST(1, GREATEST(0,
                            POWER(SIN(RADIANS(m.latitude - $1) / 2), 2) +
                            COS(RADIANS($1)) * COS(RADIANS(m.latitude)) *
                            POWER(SIN(RADIANS(m.longitude - $2) / 2), 2)
                        ))))
                    ) AS distance_km
                FROM machinery m
                JOIN users u ON u.id = m.owner_id
                WHERE m.availability = TRUE
                  AND COALESCE(m.admin_active, TRUE) = TRUE
                  AND m.latitude IS NOT NULL
                  AND m.longitude IS NOT NULL
                  AND ($18::TEXT[] IS NULL OR LOWER(TRIM(m.type)) = ANY($18::TEXT[]))
                  AND ($12::DATE IS NULL OR m.availability_start_date IS NULL OR m.availability_start_date <= $12::DATE)
                  AND ($12::DATE IS NULL OR m.availability_end_date IS NULL OR m.availability_end_date >= $12::DATE)
                  AND ($13::TIME IS NULL OR m.availability_start_time IS NULL OR m.availability_start_time <= $13::TIME)
                  AND ($14::TIME IS NULL OR m.availability_end_time IS NULL OR m.availability_end_time >= $14::TIME)
                  AND (
                    $19::BOOLEAN = FALSE OR (
                        m.availability_start_date IS NULL AND m.availability_end_date IS NULL
                        AND m.availability_start_time IS NULL AND m.availability_end_time IS NULL
                    )
                  )
                  AND (
                    $15::TEXT IS NULL OR
                    CASE
                        WHEN COALESCE(m.specifications->>'horsepower_hp', '') ~ '^\\s*[0-9]+([.][0-9]+)?\\s*$'
                        THEN (m.specifications->>'horsepower_hp')::NUMERIC >= $16::NUMERIC
                             AND ($17::NUMERIC IS NULL OR (m.specifications->>'horsepower_hp')::NUMERIC <= $17::NUMERIC)
                        ELSE FALSE
                    END
                  )
                  AND (
                    $4::TEXT IS NULL OR
                    LOWER(TRIM(m.type)) = ANY($5::TEXT[])
                  )
                  AND ($6::NUMERIC IS NULL OR m.price >= $6)
                  AND ($7::NUMERIC IS NULL OR m.price <= $7)
                  AND (
                    $8::DATE IS NULL OR NOT EXISTS (
                        SELECT 1
                        FROM bookings b
                        WHERE b.machinery_id = m.id
                          AND b.booking_date = $8::DATE
                          AND b.status IN ('pending', 'accepted')
                          AND b.start_time < $10::TIME
                          AND b.end_time > $9::TIME
                    )
                  )
                  AND (
                    $11::TEXT IS NULL OR LOWER(TRIM(COALESCE(
                        m.specifications->>'tank_capacity_l', ''
                    ))) IN (
                        $11::TEXT, $11::TEXT || ' l', $11::TEXT || ' litre',
                        $11::TEXT || ' litres', $11::TEXT || ' liter',
                        $11::TEXT || ' liters'
                    )
                  )
            )
            SELECT *
            FROM nearby
            WHERE distance_km <= $3
            ORDER BY distance_km ASC`,
            [
                latitude,
                longitude,
                radius,
                category,
                matchingTypes,
                minPrice.value,
                maxPrice.value,
                bookingDate,
                startTime,
                endTime,
                tankCapacity,
                bookingDate,
                startTime,
                endTime,
                horsepowerRange,
                horsepowerRange ? HORSEPOWER_RANGES[horsepowerRange][0] : null,
                horsepowerRange ? HORSEPOWER_RANGES[horsepowerRange][1] : null,
                APPROVED_CATEGORY_TYPES,
                availabilityMode === "no_restrictions"
            ]
        );

        console.info("Machinery search completed:", {
            farmerId: req.user.id,
            radiusKm: radius,
            category: category || "all",
            bookingDate: bookingDate || null,
            resultCount: result.rows.length,
            returnedListingIds: result.rows.map(listing => listing.id),
            returnedOwnerIds: [...new Set(result.rows.map(listing => listing.owner_id))]
        });
        res.json(result.rows);
    } catch (error) {
        console.error("Machinery search error:", {
            farmerId: req.user?.id,
            code: typeof error.code === "string" ? error.code : "unknown",
            message: error.message
        });
        res.status(500).json({ message: "Failed to search machinery" });
    }
});

module.exports = router;
