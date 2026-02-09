-- FIX STEP 2: Drop all old claim functions to start fresh
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, int, text);
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, text, uuid, int);
DROP FUNCTION IF EXISTS public.claim_free_tickets_v2(text, text, uuid, int);
DROP FUNCTION IF EXISTS public.claim_free_tickets_v3(text, text, uuid, uuid, int);