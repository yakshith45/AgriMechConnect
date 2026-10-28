const pool = require('./backend/config/db');

async function testWithTimes() {
    const bookingDate = '2026-10-26';
    const startTime = '11:00';
    const endTime = '17:00';

    const res = await pool.query(`
        SELECT
            m.id, m.name,
            m.availability,
            ($1::TIME IS NULL OR m.availability_start_time IS NULL OR m.availability_start_time <= $1::TIME) as start_ok,
            ($2::TIME IS NULL OR m.availability_end_time IS NULL OR m.availability_end_time >= $2::TIME) as end_ok
        FROM machinery m
    `, [startTime, endTime]);

    console.table(res.rows);
    await pool.end();
}

testWithTimes();
