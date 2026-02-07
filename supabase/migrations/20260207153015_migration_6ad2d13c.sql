-- Add venue_id column to player_sessions table
ALTER TABLE player_sessions ADD COLUMN venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX idx_player_sessions_venue_id ON player_sessions(venue_id);