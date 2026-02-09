-- Step 4: Add last_seen_at to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- Step 5: Create index on slug for fast lookups
CREATE INDEX IF NOT EXISTS idx_venues_slug ON venues(slug);