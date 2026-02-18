-- Step 3: Create foreign key constraint
ALTER TABLE player_answers
ADD CONSTRAINT player_answers_question_id_fkey 
FOREIGN KEY (question_id) 
REFERENCES questions(id) 
ON DELETE CASCADE;