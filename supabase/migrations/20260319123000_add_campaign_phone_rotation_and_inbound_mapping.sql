ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS enable_number_locking BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.phone_configs
ADD COLUMN IF NOT EXISTS inbound_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.campaign_phone_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  phone_config_id UUID NOT NULL REFERENCES public.phone_configs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone_config_id)
);

ALTER TABLE public.campaign_phone_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own campaign phone configs"
ON public.campaign_phone_configs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own campaign phone configs"
ON public.campaign_phone_configs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own campaign phone configs"
ON public.campaign_phone_configs
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own campaign phone configs"
ON public.campaign_phone_configs
FOR DELETE
USING (auth.uid() = user_id);

INSERT INTO public.campaign_phone_configs (user_id, campaign_id, phone_config_id, sort_order)
SELECT c.user_id, c.id, c.phone_config_id, 0
FROM public.campaigns c
WHERE c.phone_config_id IS NOT NULL
ON CONFLICT (campaign_id, phone_config_id) DO NOTHING;
