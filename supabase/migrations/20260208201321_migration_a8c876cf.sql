-- FIX STEP 1: Drop the FK constraint on player_answers first
ALTER TABLE player_answers
DROP CONSTRAINT IF EXISTS player_answers_ticket_fkey CASCADE;