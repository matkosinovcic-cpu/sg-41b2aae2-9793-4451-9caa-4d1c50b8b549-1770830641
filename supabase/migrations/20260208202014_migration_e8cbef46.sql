-- STEP 2: Now apply NOT NULL constraint
ALTER TABLE tickets
ALTER COLUMN venue_id SET NOT NULL;