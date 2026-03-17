ALTER TABLE public.phone_configs
ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE public.calendar_integrations
ADD COLUMN IF NOT EXISTS logo_url text;
