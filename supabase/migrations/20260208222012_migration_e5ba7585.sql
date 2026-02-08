-- STEP 2A: DROP the problematic 3-parameter wrapper
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, integer, text);