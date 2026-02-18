-- Fix RLS policies for ticket_questions table
DROP POLICY IF EXISTS "Authenticated users can manage ticket_questions" ON ticket_questions;
DROP POLICY IF EXISTS "Authenticated users can update ticket_questions" ON ticket_questions;

CREATE POLICY "Anyone can insert ticket_questions" ON ticket_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update ticket_questions" ON ticket_questions FOR UPDATE USING (true);