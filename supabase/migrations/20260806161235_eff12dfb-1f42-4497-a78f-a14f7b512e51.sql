CREATE TABLE public.scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'reddit',
  actor_id text NOT NULL,
  apify_run_id text,
  dataset_id text,
  status text NOT NULL DEFAULT 'queued',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  items_collected integer NOT NULL DEFAULT 0,
  opportunities_created integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_jobs TO authenticated;
GRANT ALL ON public.scan_jobs TO service_role;
ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scan jobs" ON public.scan_jobs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER scan_jobs_touch BEFORE UPDATE ON public.scan_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX scan_jobs_user_created_idx ON public.scan_jobs (user_id, created_at DESC);

CREATE TABLE public.website_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_job_id uuid REFERENCES public.scan_jobs(id) ON DELETE SET NULL,
  company_name text,
  website text NOT NULL,
  contact_page text,
  email text,
  phone text,
  industry text,
  location text,
  social_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  technologies jsonb NOT NULL DEFAULT '[]'::jsonb,
  excerpt text,
  score integer,
  intent_level text,
  problem text,
  ai_summary text,
  recommended_solution text,
  suggested_offer text,
  reply_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_reply text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_leads TO authenticated;
GRANT ALL ON public.website_leads TO service_role;
ALTER TABLE public.website_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own website leads" ON public.website_leads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER website_leads_touch BEFORE UPDATE ON public.website_leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE UNIQUE INDEX website_leads_user_website_idx ON public.website_leads (user_id, website);

CREATE TABLE public.outreach_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'reddit_assist',
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  website_lead_id uuid REFERENCES public.website_leads(id) ON DELETE CASCADE,
  target_url text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  result text,
  screenshot_path text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_queue TO authenticated;
GRANT ALL ON public.outreach_queue TO service_role;
ALTER TABLE public.outreach_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own outreach queue" ON public.outreach_queue FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER outreach_queue_touch BEFORE UPDATE ON public.outreach_queue FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX outreach_queue_ready_idx ON public.outreach_queue (status, scheduled_at);

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS suggested_offer text,
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'reddit',
  ADD COLUMN IF NOT EXISTS scan_job_id uuid REFERENCES public.scan_jobs(id) ON DELETE SET NULL;