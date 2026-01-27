-- Drop existing restrictive policies for questions table
DROP POLICY IF EXISTS "Authenticated users can insert questions" ON questions;
DROP POLICY IF EXISTS "Authenticated users can update questions" ON questions;
DROP POLICY IF EXISTS "Authenticated users can delete questions" ON questions;

-- Create permissive policies for questions (admin functionality)
CREATE POLICY "Anyone can insert questions" ON questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update questions" ON questions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete questions" ON questions FOR DELETE USING (true);