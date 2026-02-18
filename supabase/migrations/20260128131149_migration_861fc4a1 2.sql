-- Add continue_after_winner column to events table (with default OFF)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS continue_after_winner BOOLEAN DEFAULT FALSE;

-- Add comment for clarity
COMMENT ON COLUMN events.continue_after_winner IS 'Allow drawing after winner is found (default OFF for new events)';