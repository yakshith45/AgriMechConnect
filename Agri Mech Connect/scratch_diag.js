const pool = require('./backend/config/db');

async function test() {
    try {
        const users = await pool.query("SELECT id, name, email, role, selected_latitude, selected_longitude FROM users WHERE role = 'farmer'");
        console.log("Farmers count:", users.rows.length);

        const machines = await pool.query("SELECT * FROM machinery");
        console.log("Machinery in DB:");
        machines.rows.forEach(m => {
            console.log({
                id: m.id,
                name: m.name,
                type: m.type,
                owner_id: m.owner_id,
                availability: m.availability,
                admin_active: m.admin_active,
                lat: m.latitude,
                lng: m.longitude,
                start_date: m.availability_start_date,
                end_date: m.availability_end_date,
                start_time: m.availability_start_time,
                end_time: m.availability_end_time
            });
        });

        // Let's test with Veethi (id: 49) or any farmer with coordinates
        const farmer = users.rows.find(u => u.selected_latitude != null);
        console.log("\nTesting with farmer:", farmer);

        // Parameters as sent by farmer dashboard:
        // radius = 25
        // category = null (or 'all')
        // booking_date = tomorrow
        // start_time = '08:00'
        // end_time = '17:00'
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const bookingDate = tomorrow.toISOString().slice(0, 10);
        console.log("Today is:", today.toISOString().slice(0, 10), "Tomorrow is:", bookingDate);

        // Check each machine against filters
        for (const m of machines.rows) {
            console.log(`\n--- Checking machine ${m.id} (${m.name}, type: '${m.type}') ---`);
            console.log("m.availability:", m.availability);
            console.log("m.admin_active:", m.admin_active);
            console.log("m.lat/lng:", m.latitude, m.longitude);

            // Haversine
            const lat1 = farmer.selected_latitude;
            const lon1 = farmer.selected_longitude;
            const lat2 = m.latitude;
            const lon2 = m.longitude;
            const rad = Math.PI / 180;
            const dLat = (lat2 - lat1) * rad;
            const dLon = (lon2 - lon1) * rad;
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
            const dist = 6371 * 2 * Math.asin(Math.sqrt(a));
            console.log("Distance (km):", dist, "<= 25?", dist <= 25);

            console.log("Dates:", {
                m_start_date: m.availability_start_date,
                m_end_date: m.availability_end_date,
                bookingDate
            });
            console.log("Times:", {
                m_start_time: m.availability_start_time,
                m_end_time: m.availability_end_time,
                startTime: '08:00',
                endTime: '17:00'
            });

            // Date condition:
            // ($12::DATE IS NULL OR m.availability_start_date IS NULL OR m.availability_start_date <= $12::DATE)
            // AND ($12::DATE IS NULL OR m.availability_end_date IS NULL OR m.availability_end_date >= $12::DATE)
            // Time condition:
            // ($13::TIME IS NULL OR m.availability_start_time IS NULL OR m.availability_start_time <= $13::TIME)
            // AND ($14::TIME IS NULL OR m.availability_end_time IS NULL OR m.availability_end_time >= $14::TIME)
        }

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

test();
