
-- Calendar integrations table: stores user calendar provider credentials
CREATE TABLE public.calendar_integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL, -- 'google_calendar', 'cal_com', 'gohighlevel'
  display_name TEXT NOT NULL DEFAULT '',
  api_key TEXT, -- For Cal.com and GoHighLevel
  refresh_token TEXT, -- For Google Calendar OAuth
  access_token TEXT, -- For Google Calendar OAuth
  token_expires_at TIMESTAMP WITH TIME ZONE,
  calendar_id TEXT, -- Specific calendar/sub-account ID
  is_active BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}', -- Provider-specific config (e.g. default event duration, location)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.calendar_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own calendar integrations" ON public.calendar_integrations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own calendar integrations" ON public.calendar_integrations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own calendar integrations" ON public.calendar_integrations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own calendar integrations" ON public.calendar_integrations FOR DELETE USING (auth.uid() = user_id);
