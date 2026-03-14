

## Plan: Fix Call Transfer for Both Telnyx and Twilio

### Root Causes Found

**Bug 1 — Telnyx: Wrong call ID passed to Telnyx API**

In `transfer-call/index.ts` line 103:
```typescript
return await handleTelnyxTransfer(phoneConfig, call_sid, forwardingNumbers, supabase);
```
This passes `call_sid` from the request body — which is the **Ultravox call ID** (e.g., `f0040c6f-f735-4c4a-b8b1-5ee9c2bd4d0d`). But Telnyx needs the `call_control_id` (e.g., `v3:x4s5XsEY9T9BO1z-...`), which is stored in `callLog.twilio_call_sid`.

Evidence from logs:
```
Transfer call f0040c6f-f735-4c4a-b8b1-5ee9c2bd4d0d via telnyx
→ "Invalid Call Control ID"
```

**Bug 2 — Twilio: Unescaped `&` in TwiML XML makes it invalid**

The action URL in the TwiML contains raw `&` characters:
```xml
<Dial action="...?attempt=1&agent_id=abc&phone_config_id=xyz">
```
In XML, `&` must be `&amp;`. Raw `&` makes the TwiML invalid XML, causing Twilio to return "An application error occurred."

### Fix

**File: `supabase/functions/transfer-call/index.ts`**

1. **Telnyx fix** (line 103): Pass `callLog.twilio_call_sid` (the actual Telnyx call_control_id) instead of the raw `call_sid`:
```typescript
const actualTelnyxId = callLog.twilio_call_sid || call_sid;
return await handleTelnyxTransfer(phoneConfig, actualTelnyxId, forwardingNumbers, supabase);
```

2. **Twilio fix** (lines 173-174, 253, 255): Escape `&` as `&amp;` in all TwiML action URLs:
```typescript
const actionUrl = `${supabaseUrl}/functions/v1/transfer-call?attempt=${attempt + 1}&amp;agent_id=${agentId}&amp;phone_config_id=${phoneConfig.id}`;
```
Apply the same fix in the `handleTwilioCallback` function (lines 253, 255).

### Summary

| Provider | Bug | Fix |
|----------|-----|-----|
| Telnyx | Ultravox call ID passed instead of Telnyx call_control_id | Use `callLog.twilio_call_sid` |
| Twilio | Raw `&` in TwiML breaks XML parsing | Escape as `&amp;` |

Only one file changes: `supabase/functions/transfer-call/index.ts`.

