-- Add question_type column to questions table
ALTER TABLE questions 
ADD COLUMN question_type TEXT DEFAULT 'yes_no';

-- Migrate all existing questions to yes_no type
UPDATE questions 
SET question_type = 'yes_no' 
WHERE question_type IS NULL;

-- Add comment for clarity
COMMENT ON COLUMN questions.question_type IS 'Type of question: yes_no (default). Future: multiple_choice, text_input, etc.';