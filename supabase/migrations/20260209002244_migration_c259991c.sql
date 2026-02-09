-- Step 5: Since tickets stores numbers in ticket_questions table (normalized),
-- we DON'T need a ticket_numbers column. Frontend should use ticket_questions.
-- Now let's drop ALL old claim_free_tickets functions to start clean
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, int, text);
DROP FUNCTION IF EXISTS public.claim_free_tickets(text, text, uuid, int);
DROP FUNCTION IF EXISTS public.claim_free_tickets_v2(text, text, uuid, int);
DROP FUNCTION IF EXISTS public.claim_free_tickets_v3(text, text, uuid, uuid, int);