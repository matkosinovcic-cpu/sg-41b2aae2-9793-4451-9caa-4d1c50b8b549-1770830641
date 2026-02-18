-- Fix RLS policies for event_questions table
DROP POLICY IF EXISTS "Authenticated users can manage event_questions" ON event_questions;
DROP POLICY IF EXISTS "Authenticated users can update event_questions" ON event_questions;
DROP POLICY IF EXISTS "Authenticated users can delete event_questions" ON event_questions;

CREATE POLICY "Anyone can insert event_questions" ON event_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update event_questions" ON event_questions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete event_questions" ON event_questions FOR DELETE USING (true);