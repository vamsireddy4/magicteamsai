-- Only service role needs access to this table (edge functions)
-- Add a deny-all policy since no client access is needed
CREATE POLICY "No direct access" ON public.telnyx_call_state FOR ALL USING (false);