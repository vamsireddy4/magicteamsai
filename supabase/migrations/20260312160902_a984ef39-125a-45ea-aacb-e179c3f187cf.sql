CREATE TABLE public.telnyx_call_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_control_id TEXT NOT NULL UNIQUE,
  join_url TEXT NOT NULL,
  telnyx_api_key TEXT NOT NULL,
  agent_id UUID,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup old records (older than 1 hour)
CREATE INDEX idx_telnyx_call_state_created ON telnyx_call_state(created_at);

-- RLS - service role only (edge functions use service key)
ALTER TABLE public.telnyx_call_state ENABLE ROW LEVEL SECURITY;