-- Fix RLS policies for answers table (already has public insert, just update/delete)
DROP POLICY IF EXISTS "Authenticated users can delete answers" ON answers;

CREATE POLICY "Anyone can delete answers" ON answers FOR DELETE USING (true);