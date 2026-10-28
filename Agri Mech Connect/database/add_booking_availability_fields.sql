BEGIN;

ALTER TABLE machinery
    ADD COLUMN IF NOT EXISTS availability_start_date DATE,
    ADD COLUMN IF NOT EXISTS availability_end_date DATE,
    ADD COLUMN IF NOT EXISTS availability_start_time TIME,
    ADD COLUMN IF NOT EXISTS availability_end_time TIME;

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS rental_rate NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS rental_unit TEXT,
    ADD COLUMN IF NOT EXISTS estimated_total NUMERIC(12, 2);

UPDATE bookings b
SET rental_rate = m.price,
    rental_unit = COALESCE(m.price_unit, 'day'),
    estimated_total = m.price
FROM machinery m
WHERE m.id = b.machinery_id
  AND (b.rental_rate IS NULL OR b.rental_unit IS NULL OR b.estimated_total IS NULL);

ALTER TABLE bookings
    ALTER COLUMN rental_rate SET NOT NULL,
    ALTER COLUMN rental_unit SET NOT NULL,
    ALTER COLUMN estimated_total SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'machinery_availability_date_order_check'
          AND conrelid = 'machinery'::regclass
    ) THEN
        ALTER TABLE machinery ADD CONSTRAINT machinery_availability_date_order_check
            CHECK (availability_start_date IS NULL OR availability_end_date IS NULL OR availability_start_date <= availability_end_date);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'machinery_availability_time_order_check'
          AND conrelid = 'machinery'::regclass
    ) THEN
        ALTER TABLE machinery ADD CONSTRAINT machinery_availability_time_order_check
            CHECK (availability_start_time IS NULL OR availability_end_time IS NULL OR availability_start_time < availability_end_time);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bookings_rental_unit_check'
          AND conrelid = 'bookings'::regclass
    ) THEN
        ALTER TABLE bookings ADD CONSTRAINT bookings_rental_unit_check
            CHECK (rental_unit IN ('hour', 'day'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bookings_rental_amounts_check'
          AND conrelid = 'bookings'::regclass
    ) THEN
        ALTER TABLE bookings ADD CONSTRAINT bookings_rental_amounts_check
            CHECK (rental_rate >= 0 AND estimated_total >= 0);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS bookings_machinery_schedule_idx
    ON bookings (machinery_id, booking_date, start_time, end_time)
    WHERE status IN ('pending', 'accepted');

COMMIT;