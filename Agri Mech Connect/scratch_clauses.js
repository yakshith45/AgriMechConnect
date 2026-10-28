const pool = require('./backend/config/db');

async function checkWhereClauses() {
    const bookingDate = '2026-10-26';
    const startTime = '08:00';
    const endTime = '17:00';
    const radius = 25;
    const lat = 12.565245056516671;
    const lng = 75.50563211744965;

    const res = await pool.query(`
        SELECT
            m.id, m.name,
            m.availability,
            COALESCE(m.admin_active, TRUE) AS admin_active,
            m.latitude IS NOT NULL AND m.longitude IS NOT NULL AS has_coords,
            LOWER(TRIM(m.type)) = ANY(ARRAY['tractor', 'harvester', 'tiller / rotavator', 'power tiller', 'adike (arecanut) sprayer', 'agricultural drone', 'trailer']) AS valid_category,
            ($1::DATE IS NULL OR m.availability_start_date IS NULL OR m.availability_start_date <= $1::DATE) AS cond_start_date,
            ($1::DATE IS NULL OR m.availability_end_date IS NULL OR m.availability_end_date >= $1::DATE) AS cond_end_date,
            ($2::TIME IS NULL OR m.availability_start_time IS NULL OR m.availability_start_time <= $2::TIME) AS cond_start_time,
            ($3::TIME IS NULL OR m.availability_end_time IS NULL OR m.availability_end_time >= $3::TIME) AS cond_end_time,
            m.availability_start_date,
            m.availability_end_date,
            m.availability_start_time,
            m.availability_end_time
        FROM machinery m
    `, [bookingDate, startTime, endTime]);

    console.log("Detailed WHERE clause results for bookingDate =", bookingDate, "startTime =", startTime, "endTime =", endTime);
    console.table(res.rows);

    await pool.end();
}

checkWhereClauses();
