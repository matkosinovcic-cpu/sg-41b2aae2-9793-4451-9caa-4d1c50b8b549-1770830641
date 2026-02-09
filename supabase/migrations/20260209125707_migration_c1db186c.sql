-- Create claim_free_tickets_v3 with SECURITY DEFINER and explicit event_id + venue_id
DROP FUNCTION IF EXISTS public.claim_free_tickets_v3(uuid, uuid, text, text, int);

CREATE OR REPLACE FUNCTION public.claim_free_tickets_v3(
  p_event_id UUID,
  p_venue_id UUID,
  p_email TEXT,
  p_nickname TEXT,
  p_limit INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id UUID;
  v_ticket RECORD;
  v_tickets JSONB := '[]'::jsonb;
  v_claimed_count INT := 0;
BEGIN
  -- Log input parameters
  RAISE NOTICE '[claim_free_tickets_v3] Input: event_id=%, venue_id=%, email=%, nickname=%, limit=%',
    p_event_id, p_venue_id, p_email, p_nickname, p_limit;

  -- Step 1: Upsert player
  INSERT INTO public.players (email, nickname, last_seen_at)
  VALUES (p_email, p_nickname, NOW())
  ON CONFLICT (email) DO UPDATE
  SET 
    nickname = EXCLUDED.nickname,
    last_seen_at = NOW()
  RETURNING id INTO v_player_id;

  RAISE NOTICE '[claim_free_tickets_v3] Player upserted: player_id=%', v_player_id;

  -- Step 2: Claim tickets (atomically)
  FOR v_ticket IN
    UPDATE public.tickets
    SET 
      player_id = v_player_id,
      claimed_at = NOW()
    WHERE id IN (
      SELECT id
      FROM public.tickets
      WHERE event_id = p_event_id
        AND venue_id = p_venue_id
        AND player_id IS NULL
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING 
      id,
      serial_number,
      event_id,
      venue_id,
      (
        SELECT jsonb_agg(question_number ORDER BY question_number)
        FROM ticket_questions
        WHERE ticket_id = tickets.id
      ) AS numbers
  LOOP
    v_tickets := v_tickets || jsonb_build_object(
      'id', v_ticket.id,
      'serial_number', v_ticket.serial_number,
      'event_id', v_ticket.event_id,
      'venue_id', v_ticket.venue_id,
      'numbers', v_ticket.numbers
    );
    v_claimed_count := v_claimed_count + 1;
  END LOOP;

  RAISE NOTICE '[claim_free_tickets_v3] Claimed % tickets', v_claimed_count;

  -- Step 3: Return result
  RETURN jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'event_id', p_event_id,
    'venue_id', p_venue_id,
    'tickets', v_tickets,
    'claimed_count', v_claimed_count
  );
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.claim_free_tickets_v3(uuid, uuid, text, text, int) TO anon, authenticated;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';