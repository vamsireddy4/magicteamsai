

## Problem

The error `TwilioMedium has no field named "accountSid"` indicates the **deployed** edge function is running stale code from before the fix. The current file already has `medium: { twilio: {} }` (correct), but there's one remaining issue:

- **Line 129**: Model is `"fixie-ai/ultravox-70B"` — this is deprecated. Should be `"fixie-ai/ultravox-v0.7"` (or omitted to use the default).

## Plan

1. **Fix model name** in `make-outbound-call/index.ts` line 129: change `"fixie-ai/ultravox-70B"` → `"fixie-ai/ultravox-v0.7"`
2. **Fix model name** in `handle-inbound-call/index.ts` — same change
3. **Redeploy both edge functions** to ensure the latest code is live

This will resolve both the `accountSid` error (stale deployment) and prevent the deprecated model error.

