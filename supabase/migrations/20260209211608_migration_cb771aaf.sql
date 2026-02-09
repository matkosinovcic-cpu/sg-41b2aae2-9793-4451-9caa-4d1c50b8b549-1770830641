-- STEP 1: Add question_id column to ticket_questions
ALTER TABLE ticket_questions 
ADD COLUMN IF NOT EXISTS question_id uuid REFERENCES questions(id);