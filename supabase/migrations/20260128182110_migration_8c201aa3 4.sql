-- STEP 1: Add ticket_id column to player_answers table
-- Allow NULL temporarily for migration, will enforce NOT NULL for new writes
ALTER TABLE player_answers 
ADD COLUMN ticket_id TEXT;

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_player_answers_event_ticket 
ON player_answers(event_id, ticket_id);

-- Add comment explaining the column
COMMENT ON COLUMN player_answers.ticket_id IS 'Full ticket identifier string (e.g., T1769...-0001). NULL for legacy data.';