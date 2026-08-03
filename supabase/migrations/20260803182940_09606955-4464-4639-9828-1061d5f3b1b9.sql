CREATE TABLE public.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  product_name text NOT NULL DEFAULT 'Business AI solutions',
  product_url text NOT NULL DEFAULT 'https://splashdevelopmentwebsite.base44.app',
  audience text NOT NULL DEFAULT 'Canadian business owners and entrepreneurs asking for AI tools, booking/appointment software, customer management or business automation',
  country text NOT NULL DEFAULT 'Canada',
  max_contacts integer NOT NULL DEFAULT 30,
  duration_minutes integer NOT NULL DEFAULT 40,
  scans integer NOT NULL DEFAULT 30,
  pace_per_minute integer NOT NULL DEFAULT 1,
  recency_minutes integer NOT NULL DEFAULT 60,
  subreddits text[] NOT NULL DEFAULT ARRAY['smallbusiness','Entrepreneur','CanadaBusiness','smallbusinesscanada','askcanada','artificial','AI_Agents','SaaS','automation','Barber','Salons','msp'],
  specifications text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.missions TO authenticated;
GRANT ALL ON public.missions TO service_role;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own mission" ON public.missions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER missions_touch BEFORE UPDATE ON public.missions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.runs(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'reddit',
  post_url text NOT NULL,
  author text,
  subreddit text,
  title text,
  excerpt text,
  problem text,
  message text,
  country_signal text,
  intent_score integer,
  status text NOT NULL DEFAULT 'generated',
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prospects_user_post_unique ON public.prospects (user_id, post_url);
CREATE INDEX prospects_run_idx ON public.prospects (run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prospects TO authenticated;
GRANT ALL ON public.prospects TO service_role;
ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prospects" ON public.prospects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.prospects;