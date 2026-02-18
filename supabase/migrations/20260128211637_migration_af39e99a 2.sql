-- Step 1: Add question_id column to player_answers
ALTER TABLE player_answers 
ADD COLUMN question_id uuid;