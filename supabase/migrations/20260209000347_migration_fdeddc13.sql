-- Step 1: Add slug column to venues table if it doesn't exist
ALTER TABLE venues ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Step 2: Update existing venues with slugs
UPDATE venues SET slug = 'boiler' WHERE name ILIKE '%boiler%';
UPDATE venues SET slug = 'ludababa' WHERE name ILIKE '%luda%baba%' OR name ILIKE '%ludababa%';

-- Step 3: Make slug NOT NULL after populating
ALTER TABLE venues ALTER COLUMN slug SET NOT NULL;