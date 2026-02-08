-- STEP 6B: Add check constraint to prevent draw_sessions from exceeding 90 numbers
-- This is a SAFETY measure, actual draw logic should handle this
ALTER TABLE draw_sessions
DROP CONSTRAINT IF EXISTS draw_sessions_max_90_numbers;

ALTER TABLE draw_sessions
ADD CONSTRAINT draw_sessions_max_90_numbers
CHECK (array_length(drawn_numbers, 1) <= 90);