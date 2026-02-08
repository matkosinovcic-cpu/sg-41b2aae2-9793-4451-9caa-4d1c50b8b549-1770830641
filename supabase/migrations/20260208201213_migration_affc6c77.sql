-- STEP 6: Add NEW UNIQUE constraint on (serial_number, venue_id)
-- This allows same serial_number in different venues
ALTER TABLE tickets
ADD CONSTRAINT tickets_serial_number_venue_id_key
UNIQUE (serial_number, venue_id);