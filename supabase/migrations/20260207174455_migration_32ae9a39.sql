-- Add venue_slug to events table
ALTER TABLE events ADD COLUMN venue_slug text;
CREATE INDEX idx_events_venue_slug ON events(venue_slug);