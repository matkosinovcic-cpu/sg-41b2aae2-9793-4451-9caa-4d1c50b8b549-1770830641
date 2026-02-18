-- Add UNIQUE constraint on normalized email to players table
-- This enables ON CONFLICT (email) in upsert operations

-- Step 1: Create unique index on lower(email) for case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS players_email_unique_idx 
ON players (lower(trim(email)));

-- Step 2: Add check constraint to ensure email is always stored in lowercase
ALTER TABLE players 
ADD CONSTRAINT players_email_lowercase_check 
CHECK (email = lower(trim(email)));

COMMENT ON INDEX players_email_unique_idx IS 'Ensures case-insensitive email uniqueness for player upserts';
COMMENT ON CONSTRAINT players_email_lowercase_check ON players IS 'Ensures email is always stored in lowercase normalized format';