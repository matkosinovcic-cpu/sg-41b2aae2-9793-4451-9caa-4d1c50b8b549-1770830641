-- Add missing columns to draw_sessions table

-- Core required columns
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'local';
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS current_question_id uuid;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS current_question_number integer;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Recommended columns for enhanced functionality
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS question_order jsonb;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS current_index integer DEFAULT 0;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS interval_seconds integer DEFAULT 10;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS last_draw_at timestamptz;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS win_threshold integer DEFAULT 15;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS round_number integer DEFAULT 1;
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS jackpot_amount numeric(10,2);
ALTER TABLE draw_sessions ADD COLUMN IF NOT EXISTS jackpot_rollover boolean DEFAULT false;

-- Add foreign key constraint for current_question_id
ALTER TABLE draw_sessions ADD CONSTRAINT draw_sessions_current_question_id_fkey 
  FOREIGN KEY (current_question_id) REFERENCES questions(id) ON DELETE SET NULL;

-- Add check constraint for mode
ALTER TABLE draw_sessions ADD CONSTRAINT draw_sessions_mode_check 
  CHECK (mode IN ('local', 'shared'));

-- Update status check constraint to include 'paused'
ALTER TABLE draw_sessions DROP CONSTRAINT IF EXISTS draw_sessions_status_check;
ALTER TABLE draw_sessions ADD CONSTRAINT draw_sessions_status_check 
  CHECK (status IN ('draft', 'active', 'paused', 'finished'));

-- Add index on current_question_id for better performance
CREATE INDEX IF NOT EXISTS idx_draw_sessions_current_question ON draw_sessions(current_question_id);

-- Add index on mode for filtering
CREATE INDEX IF NOT EXISTS idx_draw_sessions_mode ON draw_sessions(mode);

-- Update the updated_at trigger to ensure it works properly
CREATE OR REPLACE FUNCTION update_draw_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_draw_sessions_updated_at_trigger ON draw_sessions;
CREATE TRIGGER update_draw_sessions_updated_at_trigger
  BEFORE UPDATE ON draw_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_draw_sessions_updated_at();