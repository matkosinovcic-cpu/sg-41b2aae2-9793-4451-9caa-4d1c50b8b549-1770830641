-- Create players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Anyone can create and view players (no auth required)
CREATE POLICY "Anyone can create players"
  ON players FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can view players"
  ON players FOR SELECT
  TO public
  USING (true);

-- Add player_id to player_sessions
ALTER TABLE player_sessions
ADD COLUMN player_id UUID REFERENCES players(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_player_sessions_player_id ON player_sessions(player_id);
CREATE INDEX idx_players_email ON players(email);

-- Comment for clarity
COMMENT ON TABLE players IS 'Stores minimal player profile data (nickname + email) for ticket ownership tracking';
COMMENT ON COLUMN player_sessions.player_id IS 'Links session to a player profile (created during first-time registration)';