-- Add index for performance (if we query by last_seen_at)
CREATE INDEX IF NOT EXISTS idx_players_last_seen_at ON players(last_seen_at);