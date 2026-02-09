-- 1. DROP existing function to resolve return type conflict
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, integer, text);

-- 2. Ensure DB structure
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS ticket_numbers int[] DEFAULT '{}'::int[];

-- 3. Create ROBUST LEGACY RPC (Single Event Auto-Discovery)
CREATE OR REPLACE FUNCTION public.claim_free_tickets(
    p_email text,
    p_limit integer DEFAULT 1,
    p_nickname text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_event_id uuid;
    v_player_id uuid;
    v_ticket_id uuid;
    v_serial text;
    v_tickets_created int := 0;
    i int;
    v_numbers int[];
    v_json_tickets json[] := '{}';
BEGIN
    -- 1. Find ACTIVE event (ignore venue, just take the active one)
    SELECT id INTO v_event_id
    FROM public.events
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_event_id IS NULL THEN
        RAISE EXCEPTION 'Nema aktivnog eventa (status=active) za registraciju.';
    END IF;

    -- 2. Upsert Player
    INSERT INTO public.players (email, nickname, last_seen_at)
    VALUES (p_email, p_nickname, now())
    ON CONFLICT (email) DO UPDATE
    SET 
        nickname = COALESCE(EXCLUDED.nickname, players.nickname),
        last_seen_at = now()
    RETURNING id INTO v_player_id;

    -- 3. Generate Tickets
    FOR i IN 1..p_limit LOOP
        -- Generate random numbers 1-90
        SELECT array_agg(x) INTO v_numbers 
        FROM (SELECT generate_series(1, 90) ORDER BY random() LIMIT 15) t(x);

        -- Generate Serial
        v_serial := 'T-' || floor(extract(epoch from now())) || '-' || floor(random() * 10000);

        INSERT INTO public.tickets (event_id, player_id, serial_number, ticket_numbers, created_at)
        VALUES (v_event_id, v_player_id, v_serial, v_numbers, now())
        RETURNING id INTO v_ticket_id;
        
        v_tickets_created := v_tickets_created + 1;
        
        -- Add to result array
        v_json_tickets := array_append(v_json_tickets, json_build_object(
            'id', v_ticket_id,
            'serial_number', v_serial,
            'ticket_numbers', v_numbers
        ));
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'tickets_created', v_tickets_created,
        'player_id', v_player_id,
        'event_id', v_event_id,
        'tickets', v_json_tickets
    );
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_tickets(text, integer, text) TO service_role;