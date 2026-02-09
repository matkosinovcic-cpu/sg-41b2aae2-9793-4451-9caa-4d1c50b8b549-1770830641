-- 1. Ensure ticket_numbers exists as requested
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS ticket_numbers INT[];

-- 2. Update claim_free_tickets_v3 to populate this column
CREATE OR REPLACE FUNCTION public.claim_free_tickets_v3(
  p_event_id UUID,
  p_venue_id UUID,
  p_email TEXT,
  p_nickname TEXT,
  p_limit INT DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- As requested
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_tickets JSONB;
  v_ticket_ids UUID[];
  v_generated_numbers INT[];
BEGIN
  -- 1. Get/Create Player
  INSERT INTO players (email, nickname, last_seen_at)
  VALUES (p_email, p_nickname, NOW())
  ON CONFLICT (email) DO UPDATE 
  SET nickname = p_nickname, last_seen_at = NOW()
  RETURNING id INTO v_player_id;

  -- 2. Generate random numbers (example: 15 numbers from 1-90)
  -- In a real bingo, this logic might be complex. Here we simplify or leave empty if handled elsewhere.
  -- For now, let's just initialize an empty array or generate simplistic ones if needed.
  -- user didn't ask for specific generation logic here, just that the column exists.
  v_generated_numbers := ARRAY(SELECT floor(random() * 90 + 1)::int FROM generate_series(1, 15));

  -- 3. Claim Tickets
  WITH claimed AS (
    UPDATE tickets
    SET 
      player_id = v_player_id,
      claimed_at = NOW(),
      ticket_numbers = v_generated_numbers -- Fill the new column
    WHERE id IN (
      SELECT id
      FROM tickets
      WHERE event_id = p_event_id
        AND venue_id = p_venue_id
        AND player_id IS NULL
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, serial_number, ticket_numbers, event_id, venue_id
  )
  SELECT 
    jsonb_agg(jsonb_build_object(
      'id', id,
      'serial_number', serial_number,
      'ticket_numbers', ticket_numbers,
      'event_id', event_id,
      'venue_id', venue_id
    ))
  INTO v_tickets
  FROM claimed;

  -- 4. Validation
  IF v_tickets IS NULL THEN
    RAISE EXCEPTION 'No tickets available for this event/venue';
  END IF;

  -- 5. Return result
  RETURN jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'event_id', p_event_id,
    'venue_id', p_venue_id,
    'tickets', v_tickets
  );
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.claim_free_tickets_v3 TO anon, authenticated;

-- Reload schema
NOTIFY pgrst, 'reload schema';