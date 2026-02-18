-- Fix RLS policies for events table (same issue)
DROP POLICY IF EXISTS "Authenticated users can manage events" ON events;
DROP POLICY IF EXISTS "Authenticated users can update events" ON events;
DROP POLICY IF EXISTS "Authenticated users can delete events" ON events;

CREATE POLICY "Anyone can insert events" ON events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update events" ON events FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete events" ON events FOR DELETE USING (true);