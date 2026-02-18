-- Fix RLS policies for tickets table
DROP POLICY IF EXISTS "Authenticated users can manage tickets" ON tickets;
DROP POLICY IF EXISTS "Authenticated users can update tickets" ON tickets;
DROP POLICY IF EXISTS "Authenticated users can delete tickets" ON tickets;

CREATE POLICY "Anyone can insert tickets" ON tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update tickets" ON tickets FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete tickets" ON tickets FOR DELETE USING (true);