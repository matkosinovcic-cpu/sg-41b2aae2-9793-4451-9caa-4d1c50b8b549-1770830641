-- STEP 4: Update claim_free_tickets to support venue_id
-- We need to drop and recreate it with the new parameter
DROP FUNCTION IF EXISTS claim_free_tickets(text, text, uuid, integer);
DROP FUNCTION IF EXISTS claim_free_tickets(text, text, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION claim_free_tickets(
  p_email text,
  p_nickname text,
  p_event_id uuid,
  p_venue_id uuid,  -- ✅ NEW PARAMETER
  p_limit integer DEFAULT 4
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_id uuid;
  v_session_id uuid;
  v_ticket_ids uuid[];
  v_serial text;
  v_count integer;
  v_tickets json;
  v_event_name text;
  v_venue_name text;
BEGIN
  -- 1. Get event and venue details
  SELECT name INTO v_event_name FROM events WHERE id = p_event_id;
  SELECT name INTO v_venue_name FROM venues WHERE id = p_venue_id;

  -- 2. Find or create player
  INSERT INTO players (email, nickname, created_at, last_seen_at)
  VALUES (p_email, p_nickname, now(), now())
  ON CONFLICT (email) DO UPDATE
  SET 
    nickname = EXCLUDED.nickname,
    last_seen_at = now()
  RETURNING id INTO v_player_id;

  -- 3. Find or create session
  SELECT id INTO v_session_id
  FROM player_sessions
  WHERE player_id = v_player_id AND event_id = p_event_id
  LIMIT 1;

  IF v_session_id IS NULL THEN
    INSERT INTO player_sessions (player_id, event_id, session_token)
    VALUES (v_player_id, p_event_id, gen_random_uuid())
    RETURNING id INTO v_session_id;
  END IF;

  -- 4. Check existing tickets count for this event/venue/player
  SELECT COUNT(*) INTO v_count
  FROM tickets
  WHERE event_id = p_event_id 
  AND player_id = v_player_id;
  
  -- If limit reached, return existing
  IF v_count >= p_limit THEN
     SELECT json_agg(json_build_object(
       'id', t.id,
       'serial_number', t.serial_number,
       'created_at', t.created_at,
       'venue_id', t.venue_id
     )) INTO v_tickets
     FROM tickets t
     WHERE t.event_id = p_event_id AND t.player_id = v_player_id;

     RETURN json_build_object(
       'success', true,
       'tickets_created', 0,
       'total_tickets', v_count,
       'session_id', v_session_id,
       'user_id', v_player_id,
       'tickets', COALESCE(v_tickets, '[]'::json),
       'event_name', v_event_name,
       'venue_name', v_venue_name
     );
  END IF;

  -- 5. Generate tickets up to limit
  FOR i IN 1..(p_limit - v_count) LOOP
    -- Generate unique serial for this venue
    LOOP
      v_serial := floor(random() * 900000 + 100000)::text;
      -- Check uniqueness per venue
      IF NOT EXISTS (SELECT 1 FROM tickets WHERE serial_number = v_serial AND venue_id = p_venue_id) THEN
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO tickets (
      event_id, 
      venue_id,   -- ✅ INSERTING VENUE_ID
      player_id, 
      session_id, 
      serial_number, 
      is_winner
    )
    VALUES (
      p_event_id, 
      p_venue_id, -- ✅ USING PARAMETER
      v_player_id, 
      v_session_id, 
      v_serial, 
      false
    )
    RETURNING id INTO v_ticket_ids[i];
    
    -- Generate numbers for this ticket (15 random numbers 1-90)
    INSERT INTO ticket_questions (ticket_id, question_number)
    SELECT v_ticket_ids[i], num
    FROM (
      SELECT DISTINCT ceil(random() * 90)::int as num
      FROM generate_series(1, 100)
      LIMIT 15
    ) numbers;
  END LOOP;

  -- 6. Return result
  SELECT json_agg(json_build_object(
    'id', t.id,
    'serial_number', t.serial_number,
    'created_at', t.created_at,
    'venue_id', t.venue_id
  )) INTO v_tickets
  FROM tickets t
  WHERE t.event_id = p_event_id AND t.player_id = v_player_id;

  RETURN json_build_object(
    'success', true,
    'tickets_created', (p_limit - v_count),
    'total_tickets', p_limit,
    'session_id', v_session_id,
    'user_id', v_player_id,
    'tickets', v_tickets,
    'event_name', v_event_name,
    'venue_name', v_venue_name
  );
END;
$$;