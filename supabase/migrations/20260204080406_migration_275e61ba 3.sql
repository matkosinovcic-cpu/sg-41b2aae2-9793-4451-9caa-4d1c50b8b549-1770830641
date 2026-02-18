-- Add player_id to tickets table
ALTER TABLE tickets 
ADD COLUMN player_id UUID REFERENCES players(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_tickets_player_id ON tickets(player_id);

-- Update RLS policies for tickets to allow access by player_id
CREATE POLICY "Users can view their own tickets via player_id"
  ON tickets FOR SELECT
  USING (player_id IS NOT NULL AND player_id::text = current_setting('request.jwt.claim.sub', true)); 
  -- Note: Since we use custom auth/session logic, we might need a simpler policy or rely on session_id for now.
  -- For now, let's keep it simple: public insert (controlled by service), select by serial number is already public usually.