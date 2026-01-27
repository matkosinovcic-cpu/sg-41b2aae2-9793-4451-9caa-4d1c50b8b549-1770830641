-- Create events table
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'finished')),
  current_question_number INTEGER,
  question_open_until TIMESTAMP WITH TIME ZONE,
  winner_ticket_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Public read for active events
CREATE POLICY "Anyone can view events" ON events FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage events" ON events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update events" ON events FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete events" ON events FOR DELETE USING (auth.uid() IS NOT NULL);