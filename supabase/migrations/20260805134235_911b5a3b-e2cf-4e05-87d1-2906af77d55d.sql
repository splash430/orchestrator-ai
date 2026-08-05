ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS reddit_urls text[] NOT NULL DEFAULT ARRAY['https://www.reddit.com/r/smallbusiness'::text, 'https://www.reddit.com/r/Entrepreneur'::text],
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT ARRAY['automation'::text, 'AI agent'::text, 'workflow'::text, 'CRM'::text, 'manual process'::text, 'repetitive tasks'::text],
  ADD COLUMN IF NOT EXISTS industries text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS writing_style text NOT NULL DEFAULT 'casual',
  ADD COLUMN IF NOT EXISTS post_limit integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS sort_order text NOT NULL DEFAULT 'new';

ALTER TABLE public.missions
  ADD CONSTRAINT missions_writing_style_check CHECK (writing_style IN ('professional', 'casual', 'technical')),
  ADD CONSTRAINT missions_post_limit_check CHECK (post_limit IN (10, 25, 40, 50, 70, 100)),
  ADD CONSTRAINT missions_sort_order_check CHECK (sort_order IN ('new', 'hot', 'top'));

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS post_content text,
  ADD COLUMN IF NOT EXISTS comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS engagement jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS intent_level text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS recommended_solution text,
  ADD COLUMN IF NOT EXISTS reply_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_reply text,
  ADD COLUMN IF NOT EXISTS saved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignored_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS contacted_at timestamp with time zone;

ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_intent_level_check CHECK (intent_level IS NULL OR intent_level IN ('high', 'medium', 'low'));

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  reddit_username text,
  post_url text NOT NULL,
  problem text,
  date_discovered timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'new',
  notes text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_url),
  CONSTRAINT leads_status_check CHECK (status IN ('new', 'reviewing', 'reply_drafted', 'contacted', 'conversation_started', 'converted'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own leads" ON public.leads FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER leads_touch BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();