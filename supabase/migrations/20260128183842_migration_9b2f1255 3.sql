-- STEP 1: Drop the old incorrect unique constraint
-- It prevents multiple tickets from answering the same question in one session
ALTER TABLE player_answers 
DROP CONSTRAINT IF EXISTS player_answers_session_id_question_number_key;

-- STEP 2: Add the correct unique constraint
-- One answer per (event, ticket, question) combination
ALTER TABLE player_answers 
ADD CONSTRAINT player_answers_event_ticket_question_key 
UNIQUE (event_id, ticket_id, question_number);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT player_answers_event_ticket_question_key ON player_answers IS 
'Ensures one answer per ticket per question. Allows same question to be answered by different tickets in the same session.';