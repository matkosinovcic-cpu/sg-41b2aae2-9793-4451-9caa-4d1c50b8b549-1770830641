-- Drop both overloaded versions to avoid confusion
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, integer, text);
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, text, uuid, uuid, integer);

-- Create single stable legacy function
CREATE OR REPLACE FUNCTION public.claim_free_tickets(
  p_email text,
  p_nickname text DEFAULT NULL,
  p_limit integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
  v_venue_id uuid;
  v_player_id uuid;
  v_ticket_id uuid;
  v_serial text;
  v_tickets_created int := 0;
  v_numbers int[];
  v_json_tickets json[] := '{}';
  i int;
BEGIN
  -- STEP 1: Find ACTIVE event (single event, no venue filter)
  SELECT id, venue_id INTO v_event_id, v_venue_id
  FROM public.events
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Nema aktivnog kviza. Molimo pokušajte kasnije.';
  END IF;

  -- STEP 2: Upsert Player
  INSERT INTO public.players (email, nickname, last_seen_at, created_at)
  VALUES (p_email, COALESCE(p_nickname, p_email), now(), now())
  ON CONFLICT (email) DO UPDATE
  SET 
    nickname = COALESCE(EXCLUDED.nickname, players.nickname),
    last_seen_at = now()
  RETURNING id INTO v_player_id;

  -- STEP 3: Generate Tickets with 15 UNIQUE numbers from 1-90
  FOR i IN 1..p_limit LOOP
    -- Generate 15 UNIQUE random numbers from 1-90
    WITH random_numbers AS (
      SELECT num FROM generate_series(1, 90) num
      ORDER BY random()
      LIMIT 15
    )
    SELECT array_agg(num ORDER BY num) INTO v_numbers FROM random_numbers;

    -- Generate unique serial number
    v_serial := 'T-' || floor(extract(epoch from now()) * 1000) || '-' || floor(random() * 10000);

    -- Insert ticket with venue_id (can be NULL if event has no venue)
    INSERT INTO public.tickets (
      event_id, 
      venue_id,
      player_id, 
      serial_number, 
      ticket_numbers,
      is_winner,
      created_at
    )
    VALUES (
      v_event_id, 
      v_venue_id,
      v_player_id, 
      v_serial, 
      v_numbers,
      false,
      now()
    )
    RETURNING id INTO v_ticket_id;

    -- CRITICAL: Insert 15 rows into ticket_questions (one per number)
    -- This is what the UI reads to display ticket numbers!
    INSERT INTO public.ticket_questions (ticket_id, question_number)
    SELECT v_ticket_id, unnest(v_numbers);

    v_tickets_created := v_tickets_created + 1;

    -- Build JSON response
    v_json_tickets := array_append(v_json_tickets, json_build_object(
      'id', v_ticket_id,
      'serial_number', v_serial,
      'ticket_numbers', v_numbers,
      'numbers_count', 15
    ));
  END LOOP;

  -- Return success with all ticket details
  RETURN json_build_object(
    'success', true,
    'tickets_created', v_tickets_created,
    'player_id', v_player_id,
    'event_id', v_event_id,
    'venue_id', v_venue_id,
    'tickets', v_json_tickets
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, text, integer) TO service_role;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';