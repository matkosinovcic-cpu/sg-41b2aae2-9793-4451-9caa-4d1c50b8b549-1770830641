-- Create answers table
CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  answer BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(ticket_id, question_number)
);

-- Enable RLS
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view answers" ON answers FOR SELECT USING (true);
CREATE POLICY "Anyone can insert answers" ON answers FOR INSERT WITH CHECK (true);
CREATE POLICY "No one can update answers" ON answers FOR UPDATE USING (false);
CREATE POLICY "Authenticated users can delete answers" ON answers FOR DELETE USING (auth.uid() IS NOT NULL);