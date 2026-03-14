

## Plan: Fix Call Forwarding for Telnyx + Twilio Across All AI Providers

### Root Cause

When Gemini/Sarvam bridges handle Telnyx calls, `callSid` stays empty because Telnyx stream start events don't include `call_control_id`. The `transfer-call` function then fails to find the call. For Twilio, `callSid` is populated from `msg.start.callSid` and works.

### Solution

**1. Resolve Telnyx `call_control_id` in both bridges after stream start**

In `gemini-voice-bridge/index.ts` and `sarvam-voice-bridge/index.ts`, after detecting Telnyx provider with empty `callSid`, query `call_logs` for the most recent in-progress call matching this `agent_id` and use its `twilio_call_sid` (which stores the Telnyx `call_control_id`).

```typescript
// After stream start, if Telnyx and no callSid
if (telephonyProvider === "telnyx" && !callSid && agentId) {
  const res = await fetch(
    `${sbUrl}/rest/v1/call_logs?agent_id=eq.${agentId}&status=in.("initiated","in-progress")&order=created_at.desc&limit=1&select=twilio_call_sid`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (res.ok) {
    const rows = await res.json();
    if (rows?.[0]?.twilio_call_sid) {
      callSid = rows[0].twilio_call_sid;
      console.log(`[BRIDGE] Resolved Telnyx call_control_id: ${callSid}`);
    }
  }
}
```

**2. Add `agent_id` fallback lookup in `transfer-call/index.ts`**

If the primary `call_sid` lookup fails (empty or no match), fall back to finding the active call by `agent_id`:

```typescript
// After primary lookup fails
if (!callLog && agent_id) {
  const { data } = await supabase
    .from("call_logs")
    .select("*, agents(phone_number_id)")
    .eq("agent_id", agent_id)
    .in("status", ["initiated", "in-progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (data) callLog = data;
}
```

**3. Also resolve Telnyx `call_control_id` from `telnyx_call_state` as secondary fallback**

The `telnyx_call_state` table stores `call_control_id` and `agent_id` at call creation. This is a more reliable source:

```typescript
if (telephonyProvider === "telnyx" && !callSid && agentId) {
  // Try telnyx_call_state first (most reliable)
  const stateRes = await fetch(
    `${sbUrl}/rest/v1/telnyx_call_state?agent_id=eq.${agentId}&order=created_at.desc&limit=1&select=call_control_id`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
  );
  if (stateRes.ok) {
    const rows = await stateRes.json();
    if (rows?.[0]?.call_control_id) callSid = rows[0].call_control_id;
  }
}
```

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/gemini-voice-bridge/index.ts` | Resolve Telnyx `call_control_id` after stream start |
| `supabase/functions/sarvam-voice-bridge/index.ts` | Same resolution logic |
| `supabase/functions/transfer-call/index.ts` | Add `agent_id` fallback when `call_sid` lookup fails |

### What This Fixes

- **Telnyx + Gemini**: Transfer tool now has valid `call_control_id` to pass to transfer-call
- **Telnyx + Sarvam**: Same fix
- **Telnyx + Ultravox**: Already works (Ultravox passes `call_sid` via its own tool system)
- **Twilio + all providers**: Already works (unchanged)
- **Sequential fallback**: Already implemented in `transfer-call` for both providers

