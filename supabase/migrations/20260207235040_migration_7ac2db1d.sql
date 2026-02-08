-- 1. DROP ALL VARIATIONS to clean up conflicts
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(UUID, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, INT, TEXT);

-- 2. CREATE THE CORRECT FUNCTION
CREATE OR REPLACE FUNCTION public.claim_free_tickets(
  p_email TEXT,
  p_nickname TEXT,
  p_event_id UUID,
  p_limit INT DEFAULT 4
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_id UUID;
  v_session_id UUID;
  v_event_name TEXT;
  v_event_status TEXT;
  v_ticket_count INT;
  v_new_ticket_id UUID;
  v_serial TEXT;
  i INT;
  v_created_tickets JSONB[];
BEGIN
  -- 1. Check Event
  SELECT name, status INTO v_event_name, v_event_status
  FROM events WHERE id = p_event_id;

  IF v_event_name IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'EVENT_NOT_FOUND', 'message', 'Event not found');
  END IF;

  IF v_event_status != 'active' THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'EVENT_NOT_ACTIVE', 'message', 'Event is not active');
  END IF;

  -- 2. Get or Create Player
  SELECT id INTO v_player_id FROM players WHERE email = p_email;

  IF v_player_id IS NULL THEN
    INSERT INTO players (email, nickname)
    VALUES (p_email, p_nickname)
    RETURNING id INTO v_player_id;
  END IF;

  -- 3. Ensure Session
  SELECT id INTO v_session_id FROM player_sessions 
  WHERE player_id = v_player_id AND event_id = p_event_id 
  LIMIT 1;

  IF v_session_id IS NULL THEN
    INSERT INTO player_sessions (player_id, event_id, session_token)
    VALUES (v_player_id, p_event_id, gen_random_uuid())
    RETURNING id INTO v_session_id;
  END IF;

  -- 4. Check Limits
  SELECT count(*) INTO v_ticket_count
  FROM tickets
  WHERE player_id = v_player_id AND event_id = p_event_id;

  IF v_ticket_count >= p_limit THEN
    RETURN jsonb_build_object(
      'success', FALSE, 
      'status', 'LIMIT_REACHED', 
      'message', 'Limit reached',
      'total_tickets', v_ticket_count,
      'tickets', '[]'::jsonb
    );
  END IF;

  -- 5. Create Tickets loop
  v_created_tickets := ARRAY[]::JSONB[];
  
  FOR i IN 1..(p_limit - v_ticket_count) LOOP
    -- Generate simple serial (8 chars)
    v_serial := upper(substring(md5(random()::text) from 1 for 8));
    
    INSERT INTO tickets (event_id, session_id, player_id, serial_number, is_winner)
    VALUES (p_event_id, v_session_id, v_player_id, v_serial, FALSE)
    RETURNING id INTO v_new_ticket_id;
    
    -- Generate 15 random numbers (1-90)
    INSERT INTO ticket_questions (ticket_id, question_number)
    SELECT v_new_ticket_id, num
    FROM (
      SELECT DISTINCT ceil(random() * 90)::int as num
      FROM generate_series(1, 150) -- generate more to ensure 15 distinct
    ) numbers
    WHERE num > 0 AND num <= 90
    LIMIT 15;

    v_created_tickets := array_append(v_created_tickets, jsonb_build_object(
      'id', v_new_ticket_id,
      'serial_number', v_serial,
      'source', 'free_claim',
      'created_at', now()
    ));
  END LOOP;

  -- 6. Return Success
  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'CREATED',
    'tickets_created', array_length(v_created_tickets, 1),
    'total_tickets', v_ticket_count + COALESCE(array_length(v_created_tickets, 1), 0),
    'player_id', v_player_id,
    'session_id', v_session_id,
    'user_id', v_player_id, -- alias for frontend compat
    'tickets', to_jsonb(v_created_tickets)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', FALSE, 'error', 'INTERNAL_ERROR', 'message', SQLERRM);
END;
$$;

-- 3. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(TEXT, TEXT, UUID, INT) TO anon, authenticated;