-- Dodaj FK constraint ticket_id -> tickets.serial_number
ALTER TABLE player_answers
ADD CONSTRAINT player_answers_ticket_fkey 
FOREIGN KEY (ticket_id) 
REFERENCES tickets(serial_number)
ON DELETE CASCADE;

COMMENT ON CONSTRAINT player_answers_ticket_fkey ON player_answers IS 
'Links answer to specific ticket via serial number';