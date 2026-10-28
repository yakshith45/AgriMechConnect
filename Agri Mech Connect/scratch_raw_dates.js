const pool = require('./backend/config/db');

async function checkRawDates() {
    const res = await pool.query(`
        SELECT
            id, name,
            availability_start_date::TEXT AS raw_start_date,
            availability_end_date::TEXT AS raw_end_date,
            availability_start_time::TEXT AS raw_start_time,
            availability_end_time::TEXT AS raw_end_time
        FROM machinery
    `);
    console.table(res.rows);
    await pool.end();
}

checkRawDates();
