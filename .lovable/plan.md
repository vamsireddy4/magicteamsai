

## Plan: Enable Tools, Calendar, Call Forwarding & Webhooks for All AI Providers

### Problem Summary

1. **Sarvam bridge**: Loads tools and calendar integrations but never executes them. `chatCompletion()` sends plain messages with no function-calling support.
2. **Gemini bridge**: Has tool execution implemented but calendar functions (`check-calendar-availability`, `book-calendar-appointment`) require user JWT auth — Gemini/Sarvam bridges call them server-side without user tokens, getting 401 errors.
3. **Ultravox**: Same auth issue — `temporaryTool` HTTP calls hit the edge functions without auth headers.
4. **Call forwarding**: Only works via Ultravox's `temporaryTool` HTTP mechanism. Neither Sarvam nor Gemini bridges can invoke `transfer-call` because they don't have the `twilio_call_sid` or phone config context.
5. **Webhooks**: Only synced to Ultravox platform. No webhook firing for Sarvam/Gemini calls.
6. **"No agent" in call logs**: `make-outbound-call` uses `getClaims()` which may fail silently.

---

### Implementation Tasks

#### 1. Fix Auth in `check-calendar-availability` and `book-calendar-appointment`
**Files**: `supabase/functions/check-calendar-availability/index.ts`, `supabase/functions/book-calendar-appointment/index.ts`

Add service-role key bypass: if the `Authorization` header contains the service role key, skip user auth and use `integration_id` directly (without filtering by `user_id`). This allows all three bridges (Ultravox, Gemini, Sarvam) to call these functions server-side.

```typescript
const token = authHeader.replace("Bearer ", "");
// Service role bypass for server-to-server calls from voice bridges
if (token === supabaseKey) {
  // Skip user auth, look up integration by ID only
} else {
  // Existing user auth flow
}
```

#### 2. Add Tool Execution to Sarvam Bridge
**File**: `supabase/functions/sarvam-voice-bridge/index.ts`

Since Sarvam's Chat API may not support OpenAI-style function calling reliably, use a **prompt-injection + JSON detection** approach:

- In `loadAgent()`, also fetch `appointment_tools` (with `calendar_integrations`) and `call_forwarding_numbers`.
- Inject tool descriptions into the system prompt with a structured format telling the model to output `[TOOL_CALL:tool_name|{"param":"value"}]` when it wants to invoke a tool.
- In `chatCompletion()`, after getting the response, scan for `[TOOL_CALL:...]` patterns.
- If found, execute the tool (calendar check/book via edge function, custom HTTP tool, or transfer-call), feed the result back into conversation history, and re-call chat to get a spoken response.
- For call forwarding: capture `twilio_call_sid` from Twilio stream start metadata (`msg.start?.callSid`) and store it. When transfer is requested, call `transfer-call` edge function directly via HTTP with service role auth.

#### 3. Fix Gemini Bridge Call Forwarding
**File**: `supabase/functions/gemini-voice-bridge/index.ts`

- In `loadAgent()`, also fetch `call_forwarding_numbers` and `appointment_tools`.
- Add a `transfer_call` function declaration to `buildFunctionDeclarations()` when forwarding numbers exist.
- In `executeToolCall()`, handle `transfer_call` by calling the `transfer-call` edge function via HTTP with the call SID captured from the Twilio/Telnyx stream metadata.
- Capture `callSid` from `msg.start?.callSid` (Twilio sends this in the start event).
- Fix calendar tool execution to use the edge functions with service role auth instead of direct API calls (which use outdated Cal.com v1 URLs).

#### 4. Fix Auth in `make-outbound-call`
**File**: `supabase/functions/make-outbound-call/index.ts`

Replace `getClaims()` with `getUser()` to fix "No agent" in call logs:
```typescript
const { data: { user }, error } = await supabaseClient.auth.getUser(token);
```

#### 5. Add Webhook Firing for Sarvam and Gemini Calls
**Files**: `supabase/functions/sarvam-voice-bridge/index.ts`, `supabase/functions/gemini-voice-bridge/index.ts`

- On stream start (after loading agent), fetch active webhooks for the agent from the `webhooks` table.
- Fire `call.started` webhook when the stream begins.
- Fire `call.ended` webhook on cleanup.
- Webhook firing is a simple HTTP POST to each webhook URL with the event payload and optional secret header.

#### 6. Rewrite Call Forwarding for Reliability
**File**: `supabase/functions/transfer-call/index.ts`

- Add service-role auth bypass so bridges can call it without user JWT.
- Accept `call_sid` + `agent_id` + `provider` + `phone_config_id` directly (bridges will pass these).
- For Twilio: update the live call with TwiML `<Dial>` to the first forwarding number, with action callback for sequential fallback (already implemented, just needs auth fix).
- For Telnyx: use the call control transfer API (already implemented).

---

### Technical Details

**Tool prompt injection for Sarvam** (added to system prompt):
```
--- AVAILABLE TOOLS ---
When you need to perform an action, output EXACTLY this format on a new line:
[TOOL_CALL:tool_name|{"param":"value"}]
Available tools:
- check_availability: params {date: "YYYY-MM-DD"}
- book_appointment: params {start_time, attendee_name, attendee_email, attendee_phone, notes}
- transferCall: params {} (no params needed)
- custom_tool_name: params {param1, param2}
```

**Tool execution loop in `drainTurnQueue()`**:
```
chat response → detect [TOOL_CALL:...] → execute tool → inject result → re-call chat → speak final response
```

**Files modified** (6 edge functions):
- `sarvam-voice-bridge/index.ts` — tool execution, forwarding, webhooks
- `gemini-voice-bridge/index.ts` — forwarding, webhook firing, fix calendar calls
- `check-calendar-availability/index.ts` — service role auth bypass
- `book-calendar-appointment/index.ts` — service role auth bypass
- `transfer-call/index.ts` — service role auth bypass
- `make-outbound-call/index.ts` — fix getClaims → getUser

**No database migrations needed.**

