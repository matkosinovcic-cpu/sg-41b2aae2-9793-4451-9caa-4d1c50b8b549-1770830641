-- STEP 1: Drop ALL variations of claim_free_tickets to clean cache
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(UUID, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(INT, TEXT, TEXT);

-- STEP 2: Reload PostgREST schema cache immediately
SELECT pg_notify('pgrst', 'reload schema');