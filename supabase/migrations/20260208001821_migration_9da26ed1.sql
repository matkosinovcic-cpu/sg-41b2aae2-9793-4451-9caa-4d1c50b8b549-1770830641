-- DROP both functions to recreate without max_questions
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.claim_free_tickets(TEXT, TEXT, UUID, INT);