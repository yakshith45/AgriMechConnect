BEGIN;

ALTER TABLE machinery
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS model TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS price_unit TEXT NOT NULL DEFAULT 'day',
    ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS bookings_machinery_schedule_idx
    ON bookings (machinery_id, booking_date, start_time, end_time)
    WHERE status IN ('pending', 'accepted');

COMMIT;
