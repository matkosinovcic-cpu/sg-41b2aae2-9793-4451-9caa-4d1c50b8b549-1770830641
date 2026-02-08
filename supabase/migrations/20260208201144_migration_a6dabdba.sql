-- STEP 2: Add foreign key constraint
ALTER TABLE tickets
ADD CONSTRAINT tickets_venue_id_fkey
FOREIGN KEY (venue_id)
REFERENCES venues(id)
ON DELETE CASCADE;