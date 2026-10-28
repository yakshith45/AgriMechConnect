BEGIN;

-- Initialize any empty permission arrays without removing grants from existing accounts
UPDATE users
SET allowed_roles = ARRAY[role]::TEXT[]
WHERE cardinality(allowed_roles) = 0;

-- Trigger function to strictly enforce permanent user roles
CREATE OR REPLACE FUNCTION enforce_permanent_user_role()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
        RAISE EXCEPTION 'User roles are permanent and cannot be changed after registration.';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.allowed_roles := ARRAY[NEW.role]::TEXT[];
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_permanent_user_role ON users;
CREATE TRIGGER trigger_enforce_permanent_user_role
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_permanent_user_role();

COMMIT;
