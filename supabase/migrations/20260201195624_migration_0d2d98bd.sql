-- Add session_id to tickets table to track ticket ownership
ALTER TABLE tickets 
ADD COLUMN session_id uuid REFERENCES player_sessions(id) ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX idx_tickets_session_event ON tickets(session_id, event_id);

-- Add comment for clarity
COMMENT ON COLUMN tickets.session_id IS 'Links ticket to player session for ownership tracking';