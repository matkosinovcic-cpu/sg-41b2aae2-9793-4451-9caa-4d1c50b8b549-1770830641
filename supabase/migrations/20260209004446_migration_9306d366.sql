-- FIX STEP 1: Add missing columns if they don't exist

-- Add last_seen_at to players
ALTER TABLE public.players 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- Add claimed_at to tickets (useful for analytics)
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_players_last_seen_at ON public.players(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_tickets_claimed_at ON public.tickets(claimed_at);