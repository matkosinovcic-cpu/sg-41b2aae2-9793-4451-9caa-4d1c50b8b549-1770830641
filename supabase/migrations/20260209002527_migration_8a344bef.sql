-- Step 1: Add claimed_at to tickets for tracking when it was claimed
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Step 2: Fix the RPC function to use the CORRECT column 'player_id' instead of 'claimed_by_player_id'
CREATE OR REPLACE FUNCTION public.claim_free_tickets_v2(
  p_email TEXT,
  p_nickname TEXT,
  p_venue_id UUID,
  p_limit INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_event_id UUID;
  v_ticket RECORD;
  v_tickets JSONB := '[]'::JSONB;
  v_ticket_numbers INT[];
BEGIN
  -- 1. Find or create player
  SELECT id INTO v_player_id
  FROM players
  WHERE LOWER(email) = LOWER(p_email);

  IF v_player_id IS NULL THEN
    INSERT INTO players (email, nickname, last_seen_at)
    VALUES (p_email, p_nickname, NOW())
    RETURNING id INTO v_player_id;
  ELSE
    UPDATE players
    SET nickname = p_nickname, last_seen_at = NOW()
    WHERE id = v_player_id;
  END IF;

  -- 2. Find ACTIVE event for this venue
  SELECT id INTO v_event_id
  FROM events
  WHERE venue_id = p_venue_id
    AND status ILIKE 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'NO_ACTIVE_EVENT',
      'message', 'No active event for this venue'
    );
  END IF;

  -- 3. Claim tickets atomically
  -- Find tickets available for this event AND venue that belong to NO ONE
  FOR v_ticket IN
    SELECT id, serial_number
    FROM tickets
    WHERE event_id = v_event_id
      AND venue_id = p_venue_id
      AND player_id IS NULL  -- CORRECTED: Use player_id
    ORDER BY serial_number
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Update ticket
    UPDATE tickets
    SET player_id = v_player_id,  -- CORRECTED: Use player_id
        claimed_at = NOW()
    WHERE id = v_ticket.id;

    -- Get ticket numbers (normalized)
    SELECT ARRAY_AGG(question_number ORDER BY question_number)
    INTO v_ticket_numbers
    FROM ticket_questions
    WHERE ticket_id = v_ticket.id;

    -- Add to result
    v_tickets := v_tickets || jsonb_build_object(
      'id', v_ticket.id,
      'serial_number', v_ticket.serial_number,
      'numbers', v_ticket_numbers
    );
  END LOOP;

  -- 4. Check results
  IF jsonb_array_length(v_tickets) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'NO_TICKETS',
      'message', 'No available tickets for this event'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'event_id', v_event_id,
    'venue_id', p_venue_id,
    'tickets', v_tickets
  );
END;
$$;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';