-- Add missing columns to complete the global draw architecture

-- 1. Add venue_id to events table (FK to venues)
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;

-- 2. Add finished_at to draw_sessions table
ALTER TABLE draw_sessions 
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- 3. Create index on events.venue_id for better performance
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events(venue_id);

-- 4. Add comment explaining the global draw architecture
COMMENT ON TABLE draw_sessions IS 'Global draw sessions - can be shared across multiple venues (mode=shared) or local to one event (mode=local)';
COMMENT ON COLUMN draw_sessions.mode IS 'shared = multiple venues share same draw, local = single event draw';
COMMENT ON COLUMN events.draw_session_id IS 'Links event to a draw session. Multiple events can share the same draw_session_id for global draws';
COMMENT ON COLUMN events.venue_id IS 'Links event to a specific venue. Used with venue_slug for venue identification';