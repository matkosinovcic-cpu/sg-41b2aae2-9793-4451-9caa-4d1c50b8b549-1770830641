-- Create event_questions table (90 questions per event)
CREATE TABLE event_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 90),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  drawn BOOLEAN DEFAULT FALSE,
  drawn_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(event_id, question_number),
  UNIQUE(event_id, question_id)
);

-- Enable RLS
ALTER TABLE event_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view event_questions" ON event_questions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage event_questions" ON event_questions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update event_questions" ON event_questions FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete event_questions" ON event_questions FOR DELETE USING (auth.uid() IS NOT NULL);