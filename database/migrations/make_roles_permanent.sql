BEGIN;

-- Ensure allowed_roles matches the user's permanent role for all existing users
UPDATE users
SET allowed_roles = ARRAY[role]::TEXT[]
WHERE cardinality(allowed_roles) = 0 OR allowed_roles != ARRAY[role]::TEXT[];

-- Trigger function to strictly enforce permanent user roles
CREATE OR REPLACE FUNCTION enforce_permanent_user_role()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
        RAISE EXCEPTION 'User roles are permanent and cannot be changed after registration.';
    END IF;
    NEW.allowed_roles := ARRAY[NEW.role]::TEXT[];
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_permanent_user_role ON users;
CREATE TRIGGER trigger_enforce_permanent_user_role
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_permanent_user_role();

COMMIT;
