-- 1. DROP existing function to allow return type change
DROP FUNCTION IF EXISTS public.claim_free_tickets_v3(uuid,uuid,text,text,integer);

-- 2. RECREATE function with correct JSON return type
CREATE OR REPLACE FUNCTION public.claim_free_tickets_v3(
    p_event_id uuid,
    p_venue_id uuid,
    p_email text,
    p_nickname text,
    p_limit integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_player_id uuid;
    v_ticket_id uuid;
    v_serial_number text;
    v_ticket_numbers int[];
    v_result json;
    v_tickets_created int := 0;
    v_existing_tickets_count int;
    v_event_status text;
BEGIN
    -- 1. Validate Event
    SELECT status INTO v_event_status FROM events WHERE id = p_event_id;
    
    IF v_event_status IS NULL THEN
        RAISE EXCEPTION 'Event not found (ID: %)', p_event_id;
    END IF;

    -- 2. Create/Update Player
    INSERT INTO players (email, nickname, last_seen_at, venue_id)
    VALUES (p_email, p_nickname, now(), p_venue_id)
    ON CONFLICT (email) 
    DO UPDATE SET 
        nickname = EXCLUDED.nickname,
        last_seen_at = now(),
        venue_id = COALESCE(EXCLUDED.venue_id, players.venue_id)
    RETURNING id INTO v_player_id;

    -- 3. Check existing tickets limit
    SELECT count(*) INTO v_existing_tickets_count 
    FROM tickets 
    WHERE event_id = p_event_id AND player_id = v_player_id;

    IF v_existing_tickets_count >= p_limit THEN
         SELECT json_build_object(
            'success', true,
            'message', 'Already claimed max tickets',
            'tickets_created', 0,
            'player_id', v_player_id,
            'tickets', (
                SELECT json_agg(t) FROM tickets t WHERE event_id = p_event_id AND player_id = v_player_id
            )
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- 4. Generate Ticket
    SELECT array_agg(x) INTO v_ticket_numbers 
    FROM (
        SELECT generate_series(1, 90) AS x ORDER BY random() LIMIT 15
    ) t;

    v_serial_number := 'TCK-' || floor(extract(epoch from now())) || '-' || floor(random() * 1000);

    INSERT INTO tickets (
        event_id, 
        venue_id, 
        player_id, 
        serial_number, 
        ticket_numbers,
        created_at
    )
    VALUES (
        p_event_id,
        p_venue_id,
        v_player_id,
        v_serial_number,
        v_ticket_numbers,
        now()
    )
    RETURNING id INTO v_ticket_id;

    -- Return success
    SELECT json_build_object(
        'success', true,
        'tickets_created', 1,
        'player_id', v_player_id,
        'new_ticket_id', v_ticket_id,
        'tickets', (
            SELECT json_agg(t) FROM tickets t WHERE id = v_ticket_id
        )
    ) INTO v_result;

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Claim failed: % (Code: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.claim_free_tickets_v3 TO anon;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets_v3 TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets_v3 TO service_role;