-- Add draw_mode column to events table with validation and sync logic

-- 1. Add draw_mode column with default 'local'
ALTER TABLE events
ADD COLUMN draw_mode TEXT NOT NULL DEFAULT 'local';

-- 2. Add CHECK constraint to ensure valid values
ALTER TABLE events
ADD CONSTRAINT events_draw_mode_check 
CHECK (draw_mode IN ('local', 'global'));

-- 3. Add comment for documentation
COMMENT ON COLUMN events.draw_mode IS 'Determines whether event uses local (own) or global (shared) draw session. Denormalized from draw_sessions.mode for performance.';

-- 4. Create index for filtering by draw_mode
CREATE INDEX IF NOT EXISTS idx_events_draw_mode 
ON events(draw_mode);

-- 5. Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_events_draw_mode_status 
ON events(draw_mode, status) 
WHERE status IN ('pending', 'active');

-- 6. Create trigger function to sync draw_mode with draw_sessions.mode
CREATE OR REPLACE FUNCTION sync_event_draw_mode()
RETURNS TRIGGER AS $$
BEGIN
  -- If draw_session_id is set, sync draw_mode from draw_sessions
  IF NEW.draw_session_id IS NOT NULL THEN
    SELECT mode INTO NEW.draw_mode
    FROM draw_sessions
    WHERE id = NEW.draw_session_id;
    
    -- If draw_session not found, raise error
    IF NEW.draw_mode IS NULL THEN
      RAISE EXCEPTION 'draw_session_id % does not exist', NEW.draw_session_id;
    END IF;
  ELSE
    -- If no draw_session_id, force draw_mode to 'local'
    NEW.draw_mode := 'local';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger for INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_sync_event_draw_mode ON events;
CREATE TRIGGER trigger_sync_event_draw_mode
  BEFORE INSERT OR UPDATE OF draw_session_id
  ON events
  FOR EACH ROW
  EXECUTE FUNCTION sync_event_draw_mode();

-- 8. Update existing events to sync draw_mode from their draw_sessions
UPDATE events e
SET draw_mode = ds.mode
FROM draw_sessions ds
WHERE e.draw_session_id = ds.id
  AND e.draw_mode != ds.mode;

-- 9. Verify consistency - all events with draw_session_id should match mode
DO $$
DECLARE
  mismatch_count INT;
BEGIN
  SELECT COUNT(*) INTO mismatch_count
  FROM events e
  JOIN draw_sessions ds ON e.draw_session_id = ds.id
  WHERE e.draw_mode != ds.mode;
  
  IF mismatch_count > 0 THEN
    RAISE NOTICE 'Warning: % events have mismatched draw_mode', mismatch_count;
  ELSE
    RAISE NOTICE 'All events are synchronized with draw_sessions';
  END IF;
END $$;