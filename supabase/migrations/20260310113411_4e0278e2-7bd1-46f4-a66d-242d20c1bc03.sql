
-- Campaigns table (one per venue per round)
CREATE TABLE public.campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  venue_name text NOT NULL,
  venue_location text,
  start_date date,
  end_date date,
  times text,
  age_range text,
  round integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  booking_target integer,
  twilio_phone_number text,
  elevenlabs_campaign_id text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Contacts table (cleaned contacts per campaign)
CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  phone_number text NOT NULL,
  first_name text NOT NULL,
  child_names text,
  venue_name text,
  venue_location text,
  start_date text,
  end_date text,
  times text,
  age_range text,
  sheet_reference text,
  language text DEFAULT 'en',
  voice_id text,
  first_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Call outcomes table
CREATE TABLE public.call_outcomes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  parent_name text,
  child_names text,
  venue_name text,
  outcome text NOT NULL DEFAULT 'PENDING',
  transcript text,
  summary text,
  attempt_number integer NOT NULL DEFAULT 1,
  call_timestamp timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Global do-not-call list
CREATE TABLE public.do_not_call (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  phone_number text NOT NULL,
  reason text NOT NULL,
  parent_name text,
  venue_name text,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.do_not_call ENABLE ROW LEVEL SECURITY;

-- Campaigns RLS
CREATE POLICY "Users can view own campaigns" ON public.campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own campaigns" ON public.campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own campaigns" ON public.campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own campaigns" ON public.campaigns FOR DELETE USING (auth.uid() = user_id);

-- Contacts RLS
CREATE POLICY "Users can view own contacts" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- Call outcomes RLS
CREATE POLICY "Users can view own outcomes" ON public.call_outcomes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own outcomes" ON public.call_outcomes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own outcomes" ON public.call_outcomes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own outcomes" ON public.call_outcomes FOR DELETE USING (auth.uid() = user_id);

-- Do not call RLS
CREATE POLICY "Users can view own dnc" ON public.do_not_call FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own dnc" ON public.do_not_call FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own dnc" ON public.do_not_call FOR DELETE USING (auth.uid() = user_id);

-- Updated_at triggers
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
