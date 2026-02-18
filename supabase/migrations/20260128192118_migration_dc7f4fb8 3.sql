-- KORAK 6: Dodaj index za performance (session_id, ticket_id)
CREATE INDEX IF NOT EXISTS idx_player_answers_session_ticket
ON player_answers(session_id, ticket_id);