-- 1. Add seed column to draw_sessions for deterministic question order generation
ALTER TABLE draw_sessions
ADD COLUMN IF NOT EXISTS seed integer NULL;

COMMENT ON COLUMN draw_sessions.seed IS 'Seed for deterministic question order generation. Ensures reproducible shuffling.';

-- 2. Update mode constraint to use 'global' instead of 'shared'
ALTER TABLE draw_sessions
DROP CONSTRAINT IF EXISTS draw_sessions_mode_check;

ALTER TABLE draw_sessions
ADD CONSTRAINT draw_sessions_mode_check 
CHECK (mode IN ('local', 'global'));

COMMENT ON COLUMN draw_sessions.mode IS 'global = multiple venues share same draw, local = single event draw';

-- 3. Add draw_session_id to event_questions for global draw sessions
ALTER TABLE event_questions
ADD COLUMN IF NOT EXISTS draw_session_id uuid NULL 
REFERENCES draw_sessions(id) ON DELETE CASCADE;

COMMENT ON COLUMN event_questions.draw_session_id IS 'Optional link to draw session. When set, this event_question is part of a global draw.';

-- 4. Add local prize fund to events table
ALTER TABLE events
ADD COLUMN IF NOT EXISTS local_prize_fund numeric(10,2) NULL DEFAULT 0;

COMMENT ON COLUMN events.local_prize_fund IS 'Local prize fund for this specific event/venue. Separate from global jackpot.';

-- 5. Create indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_event_questions_draw_session_id 
ON event_questions(draw_session_id);

CREATE INDEX IF NOT EXISTS idx_draw_sessions_seed 
ON draw_sessions(seed);

CREATE INDEX IF NOT EXISTS idx_events_local_prize_fund 
ON events(local_prize_fund) WHERE local_prize_fund > 0;