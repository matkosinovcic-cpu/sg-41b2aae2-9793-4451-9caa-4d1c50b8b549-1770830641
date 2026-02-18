-- Ensure UNIQUE constraint exists for idempotent UPSERT
ALTER TABLE player_answers
DROP CONSTRAINT IF EXISTS player_answers_event_ticket_question_key;

CREATE UNIQUE INDEX IF NOT EXISTS player_answers_event_ticket_question_idx
ON player_answers (event_id, ticket_id, question_number);

ALTER TABLE player_answers
ADD CONSTRAINT player_answers_event_ticket_question_key
UNIQUE USING INDEX player_answers_event_ticket_question_idx;