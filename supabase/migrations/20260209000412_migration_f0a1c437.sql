-- Step 6: Drop old claim_free_tickets functions if they exist (clean slate)
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, int, text);
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, text, uuid, int);
DROP FUNCTION IF EXISTS public.claim_free_tickets_v3(text, text, uuid, uuid, int);