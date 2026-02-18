-- Create tickets table
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  is_winner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view tickets" ON tickets FOR SELECT USING (true);
CREATE POLICY "Authenticated users can manage tickets" ON tickets FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update tickets" ON tickets FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete tickets" ON tickets FOR DELETE USING (auth.uid() IS NOT NULL);