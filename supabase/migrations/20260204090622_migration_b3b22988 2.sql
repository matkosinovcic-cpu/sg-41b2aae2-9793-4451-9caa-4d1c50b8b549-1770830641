-- Migration 2: Add UNIQUE constraint on player_sessions (player_id, event_id)
-- This prevents duplicate sessions for same player+event combo
-- Required for idempotent session creation

DO $$
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'player_sessions_player_event_unique'
  ) THEN
    -- Create unique constraint
    ALTER TABLE player_sessions 
    ADD CONSTRAINT player_sessions_player_event_unique 
    UNIQUE (player_id, event_id);
    
    RAISE NOTICE 'Added UNIQUE constraint on player_sessions(player_id, event_id)';
  ELSE
    RAISE NOTICE 'UNIQUE constraint already exists on player_sessions(player_id, event_id)';
  END IF;
END $$;

COMMENT ON CONSTRAINT player_sessions_player_event_unique ON player_sessions IS 'Ensures one session per player per event. Enables idempotent session creation.';