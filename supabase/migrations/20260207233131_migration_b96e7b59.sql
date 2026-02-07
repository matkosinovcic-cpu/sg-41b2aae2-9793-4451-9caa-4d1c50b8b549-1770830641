-- Drop existing claim_free_tickets function
DROP FUNCTION IF EXISTS claim_free_tickets(TEXT, TEXT, INTEGER);

-- Recreate with event_id parameter
CREATE OR REPLACE FUNCTION claim_free_tickets(
  p_event_id UUID,
  p_email TEXT,
  p_nickname TEXT,
  p_limit INTEGER DEFAULT 4
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_player_id UUID;
  v_session_id UUID;
  v_existing_tickets INTEGER;
  v_tickets_to_create INTEGER;
  v_ticket_record RECORD;
  v_tickets JSON[] := '{}';
  v_result JSON;
BEGIN
  -- Normalize email
  p_email := LOWER(TRIM(p_email));
  p_nickname := TRIM(p_nickname);
  
  -- Validate event exists and is active
  IF NOT EXISTS (
    SELECT 1 FROM events 
    WHERE id = p_event_id AND status = 'active'
  ) THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'NO_ACTIVE_EVENT',
      'message', 'Event is not active or does not exist'
    );
  END IF;
  
  -- Get or create player
  INSERT INTO players (email, nickname)
  VALUES (p_email, p_nickname)
  ON CONFLICT (email) 
  DO UPDATE SET 
    nickname = EXCLUDED.nickname,
    updated_at = NOW()
  RETURNING id INTO v_player_id;
  
  -- Get or create session
  INSERT INTO player_sessions (event_id, player_id, session_token)
  VALUES (p_event_id, v_player_id, gen_random_uuid()::TEXT)
  RETURNING id INTO v_session_id;
  
  -- Check existing tickets for this player + event
  SELECT COUNT(*) INTO v_existing_tickets
  FROM tickets
  WHERE player_id = v_player_id 
    AND event_id = p_event_id;
  
  -- Calculate how many to create
  v_tickets_to_create := LEAST(p_limit - v_existing_tickets, p_limit);
  
  IF v_tickets_to_create <= 0 THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'FREE_LIMIT_REACHED',
      'message', format('Player already has %s tickets for this event', v_existing_tickets),
      'tickets_created', 0,
      'total_tickets', v_existing_tickets,
      'user_id', v_player_id,
      'session_id', v_session_id
    );
  END IF;
  
  -- Create tickets atomically
  FOR i IN 1..v_tickets_to_create LOOP
    INSERT INTO tickets (
      event_id,
      serial_number,
      session_id,
      player_id,
      is_winner
    )
    VALUES (
      p_event_id,
      'PS-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8)),
      v_session_id,
      v_player_id,
      FALSE
    )
    RETURNING * INTO v_ticket_record;
    
    -- Generate 15 random numbers for ticket
    INSERT INTO ticket_questions (ticket_id, question_number)
    SELECT 
      v_ticket_record.id,
      num
    FROM (
      SELECT DISTINCT ON (num) 
        (FLOOR(RANDOM() * 90) + 1)::INTEGER AS num
      FROM generate_series(1, 100)
      LIMIT 15
    ) AS random_numbers;
    
    -- Add to result array
    v_tickets := array_append(
      v_tickets,
      json_build_object(
        'id', v_ticket_record.id,
        'serial_number', v_ticket_record.serial_number,
        'source', 'registration',
        'created_at', v_ticket_record.created_at
      )
    );
  END LOOP;
  
  -- Build success response
  v_result := json_build_object(
    'success', TRUE,
    'tickets_created', v_tickets_to_create,
    'total_tickets', v_existing_tickets + v_tickets_to_create,
    'user_id', v_player_id,
    'session_id', v_session_id,
    'tickets', array_to_json(v_tickets)
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'INTERNAL_ERROR',
      'message', SQLERRM
    );
END;
$$;