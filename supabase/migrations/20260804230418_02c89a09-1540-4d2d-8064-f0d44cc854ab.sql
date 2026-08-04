ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS qualification_reason text,
  ADD COLUMN IF NOT EXISTS rejected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS drafted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS prospects_user_created_idx ON public.prospects (user_id, created_at DESC);