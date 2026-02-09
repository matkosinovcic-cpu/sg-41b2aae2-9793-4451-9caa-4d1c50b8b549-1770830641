-- Correcting the failed migration for tickets table
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_claimed_at ON tickets(claimed_at);