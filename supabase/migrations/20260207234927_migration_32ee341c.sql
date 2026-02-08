-- DROP both versions of the function
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(UUID, TEXT, TEXT, INT);