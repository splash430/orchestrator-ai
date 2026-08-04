ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS contact_gap_seconds integer NOT NULL DEFAULT 150;

ALTER TABLE public.missions
  ALTER COLUMN duration_minutes SET DEFAULT 240,
  ALTER COLUMN max_contacts SET DEFAULT 30,
  ALTER COLUMN scans SET DEFAULT 30,
  ALTER COLUMN recency_minutes SET DEFAULT 180;

UPDATE public.missions
SET duration_minutes = 240,
    max_contacts = 30,
    scans = 30,
    contact_gap_seconds = 150,
    recency_minutes = GREATEST(recency_minutes, 180);