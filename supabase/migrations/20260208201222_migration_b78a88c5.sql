-- STEP 7: Add index for performance
CREATE INDEX IF NOT EXISTS idx_tickets_venue_id ON tickets(venue_id);