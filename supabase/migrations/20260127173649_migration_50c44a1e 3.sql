-- Create ticket_questions table (15 numbers per ticket)
CREATE TABLE ticket_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 90),
  UNIQUE(ticket_id, question_number)
);

-- Enable RLS
ALTER TABLE ticket_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view ticket_questions" ON ticket_questions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage ticket_questions" ON ticket_questions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update ticket_questions" ON ticket_questions FOR UPDATE USING (auth.uid() IS NOT NULL);