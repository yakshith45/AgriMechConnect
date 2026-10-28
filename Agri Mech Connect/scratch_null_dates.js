const pool = require('./backend/config/db');

async function testNullDates() {
    const latitude = 12.565245056516671;
    const longitude = 75.50563211744965;
    const radius = 25;
    const category = null;
    const matchingTypes = null;
    const minPrice = { value: null };
    const maxPrice = { value: null };
    const bookingDate = null;
    const startTime = null;
    const endTime = null;
    const tankCapacity = null;
    const horsepowerRange = null;
    const APPROVED_CATEGORY_TYPES = [
        "tractor",
        "harvester",
        "tiller / rotavator",
        "power tiller",
        "adike (arecanut) sprayer",
        "agricultural drone",
        "trailer"
    ];
    const availabilityMode = 'any';

    const params = [
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
        null,
        null,
        APPROVED_CATEGORY_TYPES,
        availabilityMode === "no_restrictions"
    ];

    const sql = `WITH nearby AS (
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
                WHEN COALESCE(m.specifications->>'horsepower_hp', '') ~ '^\s*[0-9]+([.][0-9]+)?\s*$'
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
    SELECT id, name, type, distance_km
    FROM nearby
    WHERE distance_km <= $3
    ORDER BY distance_km ASC`;

    const res = await pool.query(sql, params);
    console.log("Without date/time filters: count =", res.rows.length);
    console.table(res.rows);
    await pool.end();
}

testNullDates();
