
CREATE TABLE public.appointment_tools (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  calendar_integration_id UUID REFERENCES public.calendar_integrations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  appointment_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own appointment tools" ON public.appointment_tools FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own appointment tools" ON public.appointment_tools FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own appointment tools" ON public.appointment_tools FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own appointment tools" ON public.appointment_tools FOR DELETE USING (auth.uid() = user_id);
