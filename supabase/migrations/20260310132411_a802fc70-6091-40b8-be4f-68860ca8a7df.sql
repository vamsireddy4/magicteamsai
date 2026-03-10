
ALTER TABLE public.phone_configs ADD COLUMN provider text NOT NULL DEFAULT 'twilio';
ALTER TABLE public.phone_configs ALTER COLUMN twilio_account_sid DROP NOT NULL;
ALTER TABLE public.phone_configs ALTER COLUMN twilio_auth_token DROP NOT NULL;
ALTER TABLE public.phone_configs ADD COLUMN telnyx_api_key text;
ALTER TABLE public.phone_configs ADD COLUMN telnyx_connection_id text;
