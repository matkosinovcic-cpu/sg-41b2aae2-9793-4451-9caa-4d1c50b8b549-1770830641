-- Create venues table
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

-- Public read policy (anyone can view venues)
CREATE POLICY "Anyone can view venues" ON venues FOR SELECT USING (true);

-- Admin can insert/update/delete venues (authenticated users)
CREATE POLICY "Authenticated users can manage venues" ON venues FOR ALL USING (auth.uid() IS NOT NULL);