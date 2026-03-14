

## Analysis

After thoroughly reviewing the code and logs, here is what's happening:

1. **The `make-outbound-call` code is functioning correctly.** Both Twilio and Telnyx API calls succeed (200 OK), returning valid call SIDs/control IDs.
2. **The Telnyx webhook shows `call.initiated` → `call.hangup` with NO `call.answered` event.** This means the carrier is dropping the call before the recipient's phone rings.
3. **For Twilio, there is NO status callback configured**, so we have zero visibility into what happens after the call is placed.
4. **The hangup cause from Telnyx is not being logged**, so we can't see WHY the carrier dropped the call (e.g., international restrictions, invalid number, carrier rejection).

The core calling code has not changed in a way that would break call delivery. The `staticParameters` fix only affected Ultravox tool definitions, not the telephony flow. The APIs accept the call requests — the issue is downstream at the carrier level.

**The reason you can't diagnose this** is because the app currently discards all carrier feedback. We need to capture it.

## Plan

### 1. Log Telnyx hangup cause in webhook
**File:** `supabase/functions/handle-telnyx-webhook/index.ts`
- In the `call.hangup` handler, extract and log `payload.hangup_cause` and `payload.hangup_source`
- Update the corresponding `call_logs` record with the hangup reason so it's visible in the UI
- Also log the full payload for `call.initiated` events to capture any early failure signals

### 2. Add Twilio StatusCallback to outbound calls
**File:** `supabase/functions/make-outbound-call/index.ts`
- For Twilio calls (both Ultravox and Gemini paths), add `StatusCallback` and `StatusCallbackEvent` parameters to the Twilio API request
- Point the callback to a new webhook function that logs status changes

### 3. Create Twilio status webhook
**New file:** `supabase/functions/handle-twilio-status/index.ts`
- Accept Twilio's status callback (form-encoded POST)
- Extract `CallSid`, `CallStatus`, `ErrorCode`, `ErrorMessage`
- Update the matching `call_logs` record with the real Twilio status
- Log all events for debugging

### 4. Update `supabase/config.toml` for new function
- Add `[functions.handle-twilio-status]` with `verify_jwt = false` (Twilio sends unsigned webhook POSTs)

### Why this matters
Right now the app says "Call initiated!" but has no way to tell you the carrier rejected it 2 seconds later. These changes will surface the actual failure reason (e.g., "CALL_REJECTED", "UNALLOCATED_NUMBER", "INTERNATIONAL_DISABLED") so you can take action — whether that's enabling international calling on your Twilio/Telnyx account or switching to a different number.

