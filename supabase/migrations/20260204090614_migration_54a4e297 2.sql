-- Migration 1: Add updated_at column to players table
-- Required for UPSERT logic to update timestamp on conflict

DO $$ 
BEGIN
  -- Add updated_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'players' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE players ADD COLUMN updated_at timestamptz DEFAULT now();
    
    -- Set updated_at to created_at for existing rows
    UPDATE players SET updated_at = created_at WHERE updated_at IS NULL;
    
    RAISE NOTICE 'Added updated_at column to players table';
  ELSE
    RAISE NOTICE 'updated_at column already exists in players table';
  END IF;
END $$;

-- Create trigger function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_players_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS set_updated_at_on_players ON players;

-- Create trigger to auto-update updated_at on UPDATE
CREATE TRIGGER set_updated_at_on_players
  BEFORE UPDATE ON players
  FOR EACH ROW
  EXECUTE FUNCTION update_players_updated_at();

COMMENT ON COLUMN players.updated_at IS 'Timestamp of last update. Auto-updated via trigger.';
COMMENT ON TRIGGER set_updated_at_on_players ON players IS 'Automatically updates updated_at timestamp on row modification';