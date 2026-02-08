-- STEP 1: Add venue_id column to tickets table
ALTER TABLE tickets
ADD COLUMN venue_id uuid;