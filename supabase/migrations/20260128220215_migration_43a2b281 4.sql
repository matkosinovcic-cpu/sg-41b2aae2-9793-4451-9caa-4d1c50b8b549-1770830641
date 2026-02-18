-- Step 1: Drop existing restrictive RLS policies for player_answers
DROP POLICY IF EXISTS "Anyone can create answers" ON player_answers;
DROP POLICY IF EXISTS "Anyone can view answers" ON player_answers;

-- Step 2: Create permissive RLS policies
CREATE POLICY "Public can insert answers" ON player_answers
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Public can view answers" ON player_answers
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Public can update answers" ON player_answers
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);