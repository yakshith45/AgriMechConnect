BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS selected_location TEXT,
    ADD COLUMN IF NOT EXISTS selected_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS selected_longitude DOUBLE PRECISION;

UPDATE users
SET allowed_roles = ARRAY[role]
WHERE cardinality(allowed_roles) = 0;

UPDATE users
SET selected_location = farm_location,
    selected_latitude = farm_latitude,
    selected_longitude = farm_longitude
WHERE selected_location IS NULL
  AND farm_location IS NOT NULL
  AND farm_latitude IS NOT NULL
  AND farm_longitude IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_allowed_roles_valid_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_allowed_roles_valid_check
            CHECK (
                cardinality(allowed_roles) > 0
                AND allowed_roles <@ ARRAY['farmer', 'owner']::TEXT[]
                AND role = ANY(allowed_roles)
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_selected_latitude_range_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_selected_latitude_range_check
            CHECK (selected_latitude IS NULL OR selected_latitude BETWEEN -90 AND 90);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_selected_longitude_range_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_selected_longitude_range_check
            CHECK (selected_longitude IS NULL OR selected_longitude BETWEEN -180 AND 180);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_selected_coordinates_pair_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_selected_coordinates_pair_check
            CHECK (
                (selected_latitude IS NULL AND selected_longitude IS NULL) OR
                (selected_latitude IS NOT NULL AND selected_longitude IS NOT NULL)
            );
    END IF;
END;
$$;

COMMIT;
