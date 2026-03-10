
-- Webhooks table: per-agent webhook configurations
CREATE TABLE public.webhooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{"call.completed"}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  secret TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own webhooks" ON public.webhooks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own webhooks" ON public.webhooks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own webhooks" ON public.webhooks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own webhooks" ON public.webhooks FOR DELETE USING (auth.uid() = user_id);

-- Scheduled calls table: calendar-based call scheduling
CREATE TABLE public.scheduled_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  recipient_number TEXT NOT NULL,
  recipient_name TEXT,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scheduled calls" ON public.scheduled_calls FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own scheduled calls" ON public.scheduled_calls FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own scheduled calls" ON public.scheduled_calls FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own scheduled calls" ON public.scheduled_calls FOR DELETE USING (auth.uid() = user_id);

-- Agent tools table: custom tools the AI agent can invoke mid-call
CREATE TABLE public.agent_tools (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_type TEXT NOT NULL DEFAULT 'http',
  http_method TEXT NOT NULL DEFAULT 'POST',
  http_url TEXT NOT NULL,
  http_headers JSONB DEFAULT '{}',
  http_body_template JSONB DEFAULT '{}',
  parameters JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agent tools" ON public.agent_tools FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own agent tools" ON public.agent_tools FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own agent tools" ON public.agent_tools FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own agent tools" ON public.agent_tools FOR DELETE USING (auth.uid() = user_id);
