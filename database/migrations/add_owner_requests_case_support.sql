-- Safe, non-destructive migration: update owner_access_requests status check and unique index
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'owner_access_requests_status_check'
          AND conrelid = 'owner_access_requests'::regclass
    ) THEN
        ALTER TABLE owner_access_requests DROP CONSTRAINT owner_access_requests_status_check;
    END IF;

    ALTER TABLE owner_access_requests
        ADD CONSTRAINT owner_access_requests_status_check
        CHECK (lower(status) IN ('pending', 'approved', 'rejected', 'revoked'));

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'owner_access_requests'
          AND indexname = 'owner_access_requests_one_pending_per_user_idx'
    ) THEN
        DROP INDEX owner_access_requests_one_pending_per_user_idx;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS owner_access_requests_one_pending_per_user_idx
        ON owner_access_requests(user_id)
        WHERE lower(status) = 'pending';
END $$;
