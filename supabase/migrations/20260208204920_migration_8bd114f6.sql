-- Add last_seen_at column to players table
ALTER TABLE players
ADD COLUMN last_seen_at timestamp with time zone NULL DEFAULT now();