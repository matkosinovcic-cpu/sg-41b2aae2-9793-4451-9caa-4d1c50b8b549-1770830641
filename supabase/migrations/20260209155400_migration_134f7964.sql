-- Remove NOT NULL constraint from venue_id in tickets table
ALTER TABLE public.tickets 
ALTER COLUMN venue_id DROP NOT NULL;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';