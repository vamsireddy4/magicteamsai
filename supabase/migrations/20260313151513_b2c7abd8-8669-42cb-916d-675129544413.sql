
CREATE TABLE public.call_forwarding_numbers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.call_forwarding_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own forwarding numbers" ON public.call_forwarding_numbers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own forwarding numbers" ON public.call_forwarding_numbers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own forwarding numbers" ON public.call_forwarding_numbers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own forwarding numbers" ON public.call_forwarding_numbers FOR DELETE USING (auth.uid() = user_id);
