-- Step 4: Create index for performance
CREATE INDEX idx_player_answers_question_id 
ON player_answers(question_id);