-- STEP 1: Drop ALL versions of claim_free_tickets function
-- This ensures no old cached versions exist
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, UUID, INT);
DROP FUNCTION IF EXISTS claim_free_tickets(TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS claim_free_tickets(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS claim_free_tickets(TEXT, TEXT, UUID, INT);