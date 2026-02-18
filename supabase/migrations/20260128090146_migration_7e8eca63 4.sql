-- Create player_sessions table to track unique player sessions
CREATE TABLE IF NOT EXISTS player_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create player_answers table to store answers
CREATE TABLE IF NOT EXISTS player_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES player_sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  answer_yesno TEXT NOT NULL CHECK (answer_yesno IN ('YES', 'NO')),
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(session_id, question_number)
);

-- Enable RLS
ALTER TABLE player_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_answers ENABLE ROW LEVEL SECURITY;

-- RLS policies for player_sessions (public read/write for anonymous players)
CREATE POLICY "Anyone can create sessions" ON player_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view sessions" ON player_sessions FOR SELECT USING (true);

-- RLS policies for player_answers (public read/write for anonymous players)
CREATE POLICY "Anyone can create answers" ON player_answers FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view answers" ON player_answers FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX idx_player_sessions_event ON player_sessions(event_id);
CREATE INDEX idx_player_sessions_token ON player_sessions(session_token);
CREATE INDEX idx_player_answers_session ON player_answers(session_id);
CREATE INDEX idx_player_answers_event ON player_answers(event_id);
CREATE INDEX idx_player_answers_question ON player_answers(session_id, question_number);

-- Verify tables created
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('player_sessions', 'player_answers');