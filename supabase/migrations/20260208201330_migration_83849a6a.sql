-- FIX STEP 2: Now drop the old UNIQUE constraint (should work now)
ALTER TABLE tickets
DROP CONSTRAINT IF EXISTS tickets_serial_number_key CASCADE;