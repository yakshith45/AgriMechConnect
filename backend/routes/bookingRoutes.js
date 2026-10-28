const express = require("express");
const pool = require("../config/db");
const {
    authenticateToken,
    requireRole
} = require("../middleware/authMiddleware");

const router = express.Router();

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value &&
        value >= new Date().toISOString().slice(0, 10);
}

function validTime(value) {
    return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function rentalEstimate(startTime, endTime, rate, unit) {
    const [startHour, startMinute] = startTime.split(":").map(Number);
    const [endHour, endMinute] = endTime.split(":").map(Number);
    const durationHours = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60;
    const units = unit === "hour" ? durationHours : Math.max(1, Math.ceil(durationHours / 24));
    return Math.round(Number(rate) * units * 100) / 100;
}

function normalizeDateStr(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function normalizeTimeStr(value) {
    if (!value) return null;
    return String(value).trim().slice(0, 5);
}

function withinListingAvailability(listing, date, startTime, endTime) {
    const d = normalizeDateStr(date);
    const s = normalizeTimeStr(startTime);
    const e = normalizeTimeStr(endTime);
    const availStartDate = normalizeDateStr(listing.availability_start_date);
    const availEndDate = normalizeDateStr(listing.availability_end_date);
    const availStartTime = normalizeTimeStr(listing.availability_start_time);
    const availEndTime = normalizeTimeStr(listing.availability_end_time);

    if (availStartDate && d && d < availStartDate) return false;
    if (availEndDate && d && d > availEndDate) return false;
    if (availStartTime && s && s < availStartTime) return false;
    if (availEndTime && e && e > availEndTime) return false;
    return true;
}

function formatAvailabilityMismatchMessage(listing) {
    const availStart = normalizeTimeStr(listing.availability_start_time);
    const availEnd = normalizeTimeStr(listing.availability_end_time);
    const availStartDate = normalizeDateStr(listing.availability_start_date);
    const availEndDate = normalizeDateStr(listing.availability_end_date);

    let message = "This time is outside the owner's listed availability.";
    const parts = [];
    if (availStart && availEnd) {
        parts.push(`daily hours are ${availStart} to ${availEnd}`);
    } else if (availStart) {
        parts.push(`daily start time is ${availStart}`);
    } else if (availEnd) {
        parts.push(`daily end time is ${availEnd}`);
    }
    if (availStartDate && availEndDate) {
        parts.push(`dates are ${availStartDate} to ${availEndDate}`);
    } else if (availStartDate) {
        parts.push(`available from date ${availStartDate}`);
    } else if (availEndDate) {
        parts.push(`available until date ${availEndDate}`);
    }
    if (parts.length) {
        message += ` Owner's listed availability: ${parts.join(", ")}.`;
    }
    return message;
}

router.post("/", authenticateToken, requireRole("farmer"), async (req, res) => {
    const { machinery_id: machineryId, booking_date: bookingDate, start_time: startTime, end_time: endTime } = req.body;
    if (!/^\d+$/.test(String(machineryId ?? ""))) {
        return res.status(400).json({ message: "Choose a valid machinery listing." });
    }
    if (!validDate(bookingDate) || !validTime(startTime) || !validTime(endTime) || endTime <= startTime) {
        return res.status(400).json({
            message: "Choose a valid future date and an end time later than the start time."
        });
    }

    let client;
    let transactionOpen = false;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        transactionOpen = true;

        const listingResult = await client.query(
                `SELECT id, availability, admin_active, price, price_unit,
                    availability_start_date::TEXT, availability_end_date::TEXT,
                    availability_start_time::TEXT, availability_end_time::TEXT
             FROM machinery
             WHERE id = $1
             FOR UPDATE`,
            [machineryId]
        );
        if (!listingResult.rows.length || !listingResult.rows[0].availability || !listingResult.rows[0].admin_active) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ message: "Machinery is not currently available." });
        }
        const listing = listingResult.rows[0];
        if (!withinListingAvailability(listing, bookingDate, startTime, endTime)) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({ message: formatAvailabilityMismatchMessage(listing) });
        }

        const overlap = await client.query(
            `SELECT id
             FROM bookings
             WHERE machinery_id = $1
               AND booking_date = $2
               AND status IN ('pending', 'accepted')
               AND start_time < $4::TIME
               AND end_time > $3::TIME
             LIMIT 1`,
            [machineryId, bookingDate, startTime, endTime]
        );
        if (overlap.rows.length) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({
                message: "This machinery has a pending or accepted booking that overlaps this time. Choose another time."
            });
        }

        const result = await client.query(
            `INSERT INTO bookings
                (farmer_id, machinery_id, booking_date, start_time, end_time,
                 rental_rate, rental_unit, estimated_total, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
             RETURNING *`,
            [
                req.user.id,
                machineryId,
                bookingDate,
                startTime,
                endTime,
                listing.price,
                listing.price_unit || "day",
                rentalEstimate(startTime, endTime, listing.price, listing.price_unit || "day")
            ]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        res.status(201).json({
            message: "Booking request sent. The machinery owner will review it.",
            booking: result.rows[0]
        });
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Booking rollback failed:", rollbackError.message);
            }
        }
        console.error("Booking creation failed:", error.message);
        res.status(500).json({ message: "Booking failed. Your request was not saved." });
    } finally {
        client?.release();
    }
});

router.get("/farmer", authenticateToken, requireRole("farmer"), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*, 
                    (b.created_at + INTERVAL '6 hours') AS cancellation_deadline,
                    (b.created_at > NOW() - INTERVAL '6 hours') AS cancellation_allowed,
                    m.name AS machinery_name, m.type AS machinery_type,
                    m.location, m.price, m.price_unit, m.image_url, m.specifications,
                    b.rental_rate, b.rental_unit, b.estimated_total,
                    u.name AS owner_name, u.phone AS owner_phone
             FROM bookings b
             JOIN machinery m ON b.machinery_id = m.id
             JOIN users u ON m.owner_id = u.id
             WHERE b.farmer_id = $1
             ORDER BY b.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Farmer booking fetch failed:", error.message);
        res.status(500).json({ message: "Failed to fetch bookings" });
    }
});

router.get("/owner", authenticateToken, requireRole("owner"), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*, m.name AS machinery_name, m.type AS machinery_type,
                    m.location, m.price, m.price_unit, m.image_url, m.specifications,
                    b.rental_rate, b.rental_unit, b.estimated_total,
                    u.name AS farmer_name, u.phone AS farmer_phone, u.email AS farmer_email,
                    COALESCE(u.selected_location, u.farm_location) AS farmer_location,
                    COALESCE(u.selected_latitude, u.farm_latitude) AS farmer_latitude,
                    COALESCE(u.selected_longitude, u.farm_longitude) AS farmer_longitude
             FROM bookings b
             JOIN machinery m ON b.machinery_id = m.id
             JOIN users u ON b.farmer_id = u.id
             WHERE m.owner_id = $1
             ORDER BY b.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Owner booking fetch failed:", error.message);
        res.status(500).json({ message: "Failed to fetch requests" });
    }
});

router.put("/:id/status", authenticateToken, async (req, res) => {
    const { status } = req.body;
    const isOwner = req.user.role === "owner";
    const isFarmer = req.user.role === "farmer";
    const allowedStatus = isOwner
        ? ["accepted", "rejected", "completed"].includes(status)
            : isFarmer && status === "cancelled";
    if (!allowedStatus) {
        return res.status(400).json({ message: "This account cannot set the requested booking status." });
    }
    if (!/^\d+$/.test(req.params.id)) {
        return res.status(400).json({ message: "Invalid booking ID." });
    }

    let client;
    let transactionOpen = false;
    try {
        client = await pool.connect();
        await client.query("BEGIN");
        transactionOpen = true;

        const referenceResult = await client.query(
            `SELECT machinery_id
             FROM bookings
             WHERE id = $1`,
            [req.params.id]
        );
        if (!referenceResult.rows.length) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ message: "Booking not found." });
        }

        const machineryResult = await client.query(
            `SELECT id
             FROM machinery
             WHERE id = $1
             FOR UPDATE`,
            [referenceResult.rows[0].machinery_id]
        );
        if (!machineryResult.rows.length) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ message: "Machinery listing not found." });
        }

        const bookingResult = await client.query(
                `SELECT b.*, m.owner_id, m.availability,
                    (b.created_at > NOW() - INTERVAL '6 hours') AS cancellation_allowed,
                    m.availability_start_date::TEXT, m.availability_end_date::TEXT,
                    m.availability_start_time::TEXT, m.availability_end_time::TEXT
             FROM bookings b
             JOIN machinery m ON m.id = b.machinery_id
             WHERE b.id = $1
             FOR UPDATE OF b`,
            [req.params.id]
        );
        const booking = bookingResult.rows[0];
        if (!booking) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ message: "Booking not found." });
        }
        if (
            (isOwner && String(booking.owner_id) !== String(req.user.id)) ||
            (isFarmer && String(booking.farmer_id) !== String(req.user.id))
        ) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(403).json({ message: "You are not authorized to update this booking." });
        }

        const validTransition = isOwner
            ? (booking.status === "pending" && ["accepted", "rejected"].includes(status)) ||
                (booking.status === "accepted" && status === "completed")
            : ["pending", "accepted"].includes(booking.status) && status === "cancelled";
        if (!validTransition) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({
                message: "This booking can no longer be changed from its current status."
            });
        }

        if (isOwner && status === "accepted" && (
            !booking.availability ||
            !withinListingAvailability(booking, booking.booking_date, booking.start_time, booking.end_time)
        )) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({ message: "This listing is no longer available for the requested date and time." });
        }

        if (!isOwner && status === "cancelled") {
            if (booking.cancellation_allowed !== true) {
                await client.query("ROLLBACK");
                transactionOpen = false;
                return res.status(409).json({
                    message: "The 6-hour cancellation period has expired. This booking can no longer be cancelled by the farmer."
                });
            }
        }

        if (isOwner && status === "accepted") {
            const conflict = await client.query(
                `SELECT id
                 FROM bookings
                 WHERE machinery_id = $1
                   AND id <> $2
                   AND booking_date = $3
                   AND status = 'accepted'
                   AND start_time < $5::TIME
                   AND end_time > $4::TIME
                 LIMIT 1`,
                [booking.machinery_id, booking.id, booking.booking_date, booking.start_time, booking.end_time]
            );
            if (conflict.rows.length) {
                await client.query("ROLLBACK");
                transactionOpen = false;
                return res.status(409).json({
                    message: "Another booking for this machinery has already been accepted for an overlapping time."
                });
            }
        }

        const updated = await client.query(
            `UPDATE bookings
             SET status = $1
             WHERE id = $2
             RETURNING *`,
            [status, booking.id]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        res.json({
            message: status === "accepted"
                ? "Booking Successfully Accepted"
                : `Booking ${status}.`,
            booking: updated.rows[0]
        });
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Booking status rollback failed:", rollbackError.message);
            }
        }
        console.error("Booking status update failed:", error.message);
        res.status(500).json({ message: "Failed to update booking status." });
    } finally {
        client?.release();
    }
});

module.exports = router;
