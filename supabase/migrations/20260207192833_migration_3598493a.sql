-- Create draw_sessions table
CREATE TABLE draw_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'finished')),
  total_questions INTEGER NOT NULL DEFAULT 90,
  drawn_numbers INTEGER[] NOT NULL DEFAULT '{}',
  current_number INTEGER,
  draw_count INTEGER NOT NULL DEFAULT 0,
  question_open_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_draw_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER draw_sessions_updated_at
BEFORE UPDATE ON draw_sessions
FOR EACH ROW
EXECUTE FUNCTION update_draw_sessions_updated_at();

-- Add draw_session_id to events table
ALTER TABLE events ADD COLUMN draw_session_id UUID REFERENCES draw_sessions(id);

-- Create indexes for performance
CREATE INDEX idx_events_draw_session_id ON events(draw_session_id);
CREATE INDEX idx_draw_sessions_status ON draw_sessions(status);

-- Enable RLS on draw_sessions
ALTER TABLE draw_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for draw_sessions (public read, authenticated write)
CREATE POLICY "Anyone can view draw sessions" ON draw_sessions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert draw sessions" ON draw_sessions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update draw sessions" ON draw_sessions FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete draw sessions" ON draw_sessions FOR DELETE USING (auth.uid() IS NOT NULL);