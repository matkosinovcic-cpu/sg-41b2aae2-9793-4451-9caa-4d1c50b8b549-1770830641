-- Drop existing function with wrong signature
DROP FUNCTION IF EXISTS claim_free_tickets(TEXT, TEXT, UUID, INT);

-- Create new function with correct parameter order to match frontend call
-- Frontend calls: claim_free_tickets(email, nickname, event_id, limit)
-- So SQL function must accept: (p_email, p_nickname, p_event_id, p_limit)
CREATE OR REPLACE FUNCTION claim_free_tickets(
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
  v_event_id UUID;
  v_event_name TEXT;
  v_event_status TEXT;
  v_venue_slug TEXT;
  v_max_questions INT;
  v_existing_tickets INT;
  v_tickets_to_create INT;
  v_created_tickets JSONB := '[]'::JSONB;
  v_ticket_id UUID;
  v_ticket_number INT;
BEGIN
  -- Validate and get event details
  SELECT id, name, status, venue_slug, max_questions
  INTO v_event_id, v_event_name, v_event_status, v_venue_slug, v_max_questions
  FROM events
  WHERE id = p_event_id;

  -- Event must exist
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'status', 'ERROR',
      'error', 'EVENT_NOT_FOUND',
      'message', 'Event does not exist'
    );
  END IF;

  -- Event must be active
  IF v_event_status != 'active' THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'status', 'ERROR',
      'error', 'EVENT_NOT_ACTIVE',
      'message', 'Event "' || v_event_name || '" is not active'
    );
  END IF;

  -- Get or create player
  SELECT id INTO v_player_id
  FROM players
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(p_email));

  IF v_player_id IS NULL THEN
    -- Create new player
    INSERT INTO players (email, nickname, created_at)
    VALUES (TRIM(p_email), TRIM(p_nickname), NOW())
    RETURNING id INTO v_player_id;
    
    RAISE NOTICE 'Created new player: %', v_player_id;
  ELSE
    -- Update nickname if provided
    IF p_nickname IS NOT NULL AND TRIM(p_nickname) != '' THEN
      UPDATE players
      SET nickname = TRIM(p_nickname)
      WHERE id = v_player_id;
    END IF;
    
    RAISE NOTICE 'Using existing player: %', v_player_id;
  END IF;

  -- Check existing tickets for this player and event
  SELECT COUNT(*) INTO v_existing_tickets
  FROM tickets
  WHERE player_id = v_player_id
    AND event_id = v_event_id;

  RAISE NOTICE 'Player % has % existing tickets for event %', v_player_id, v_existing_tickets, v_event_id;

  -- Check if limit reached
  IF v_existing_tickets >= p_limit THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'status', 'LIMIT_REACHED',
      'message', 'Već ste preuzeli maksimalan broj tiketa (' || p_limit || ') za ovaj event',
      'player_id', v_player_id,
      'existing_tickets', v_existing_tickets,
      'limit', p_limit
    );
  END IF;

  -- Calculate how many tickets to create
  v_tickets_to_create := LEAST(p_limit - v_existing_tickets, p_limit);

  RAISE NOTICE 'Creating % tickets for player %', v_tickets_to_create, v_player_id;

  -- Create tickets
  FOR i IN 1..v_tickets_to_create LOOP
    -- Get next ticket number for this event
    SELECT COALESCE(MAX(ticket_number), 0) + 1
    INTO v_ticket_number
    FROM tickets
    WHERE event_id = v_event_id;

    -- Insert ticket
    INSERT INTO tickets (
      player_id,
      event_id,
      ticket_number,
      created_at
    )
    VALUES (
      v_player_id,
      v_event_id,
      v_ticket_number,
      NOW()
    )
    RETURNING id INTO v_ticket_id;

    -- Add to created tickets array
    v_created_tickets := v_created_tickets || jsonb_build_object(
      'id', v_ticket_id,
      'ticket_number', v_ticket_number
    );

    RAISE NOTICE 'Created ticket %: number %', v_ticket_id, v_ticket_number;
  END LOOP;

  -- Return success
  RETURN jsonb_build_object(
    'success', TRUE,
    'status', 'CREATED',
    'message', 'Uspješno kreirano ' || v_tickets_to_create || ' tiketa',
    'player_id', v_player_id,
    'event_id', v_event_id,
    'event_name', v_event_name,
    'venue_slug', v_venue_slug,
    'tickets_created', v_tickets_to_create,
    'total_tickets', v_existing_tickets + v_tickets_to_create,
    'limit', p_limit,
    'tickets', v_created_tickets
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in claim_free_tickets: %', SQLERRM;
    RETURN jsonb_build_object(
      'success', FALSE,
      'status', 'ERROR',
      'error', 'INTERNAL_ERROR',
      'message', SQLERRM
    );
END;
$$;