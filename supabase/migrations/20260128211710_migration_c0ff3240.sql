-- Step 5: Make question_id NOT NULL (after data is populated)
ALTER TABLE player_answers 
ALTER COLUMN question_id SET NOT NULL;