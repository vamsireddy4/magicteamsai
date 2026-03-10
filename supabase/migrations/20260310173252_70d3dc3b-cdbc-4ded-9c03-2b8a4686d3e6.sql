
ALTER TABLE public.campaigns 
  ADD COLUMN IF NOT EXISTS phone_config_id uuid REFERENCES public.phone_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delay_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS calls_made integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_contacts integer NOT NULL DEFAULT 0;
