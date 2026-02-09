-- Step 3: Add last_seen_at to players if it doesn't exist
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_players_last_seen_at ON public.players(last_seen_at);