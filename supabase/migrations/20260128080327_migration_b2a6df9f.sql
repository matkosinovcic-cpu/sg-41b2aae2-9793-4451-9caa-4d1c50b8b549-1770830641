-- Add drawn_numbers array and current_drawn_number to events table
ALTER TABLE events
ADD COLUMN drawn_numbers integer[] DEFAULT '{}',
ADD COLUMN current_drawn_number integer NULL;

-- Create index for faster lookups
CREATE INDEX idx_events_drawn_numbers ON events USING GIN (drawn_numbers);