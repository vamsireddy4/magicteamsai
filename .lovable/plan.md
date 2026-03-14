

## Plan: Align Ultravox Tool/Webhook JSON + Build Gemini/Sarvam Tool Execution From Scratch

### Issues Found

After thorough review of the Ultravox docs and current code, here are the specific problems:

#### Ultravox Issues

1. **Webhook `secret` vs `secrets`**: The Ultravox webhook API expects `secrets` (array of strings), but the code sends `secret` (single string). This means webhook secrets are silently dropped.

2. **`handle-inbound-call` is missing `defaultReaction` and `staticResponse`**: The `sync-ultravox-agent` function correctly reads `__agentEndBehavior` and `__staticResponse` from the body template and maps them to `defaultReaction`/`staticResponse` on the tool. But `handle-inbound-call` and `make-outbound-call` do NOT include these fields — meaning tools with "Agent End Behavior" settings lose that behavior on live calls.

3. **`handle-inbound-call` missing `END_BEHAVIOR_MAP`**: The inbound call handler doesn't map advanced tool settings at all.

4. **`make-outbound-call` missing `END_BEHAVIOR_MAP`**: Same issue — no `defaultReaction` or `staticResponse` on outbound call tools.

5. **Provider field missing on `transferCall` in `handle-inbound-call`**: The `provider` static parameter for the transfer tool is correctly set in `make-outbound-call` and `sync-ultravox-agent`, and also in `handle-inbound-call`. This is fine.

#### Gemini/Sarvam Issues

6. **Gemini & Sarvam already have full tool execution** built from scratch (KB, custom tools, calendar, transfer, webhooks). The code is structurally complete. The remaining issues are edge cases in execution (covered in previous fix round).

### Implementation Plan

#### 1. Fix Ultravox Webhook `secrets` Format (sync-ultravox-agent)
- Change `whBody.secret = wh.secret` → `whBody.secrets = [wh.secret]` to match Ultravox API schema

#### 2. Add `defaultReaction` + `staticResponse` to `handle-inbound-call`
- Add `END_BEHAVIOR_MAP` constant
- Read `__agentEndBehavior` and `__staticResponse` from each tool's `http_body_template`
- Set `temporaryTool.defaultReaction` and `temporaryTool.staticResponse` accordingly

#### 3. Add `defaultReaction` + `staticResponse` to `make-outbound-call`
- Same as above — mirror the logic from `sync-ultravox-agent`

### Files to Modify

1. **`supabase/functions/sync-ultravox-agent/index.ts`** — Fix webhook `secrets` array format
2. **`supabase/functions/handle-inbound-call/index.ts`** — Add `END_BEHAVIOR_MAP`, `defaultReaction`, `staticResponse` to tool definitions
3. **`supabase/functions/make-outbound-call/index.ts`** — Same additions

### Technical Details

**Webhook fix (sync-ultravox-agent line ~479)**:
```typescript
// Before (wrong):
if (wh.secret) whBody.secret = wh.secret;

// After (correct per Ultravox API):
if (wh.secret) whBody.secrets = [wh.secret];
```

**Tool advanced settings (handle-inbound-call + make-outbound-call)**:
```typescript
const END_BEHAVIOR_MAP: Record<string, string> = {
  "Speaks": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS",
  "Listens": "AGENT_TEXT_BEHAVIOR_AGENT_LISTENS",
  "Speaks Once": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS_ONCE",
};

// After building temporaryTool:
const bodyMeta = tool.http_body_template as Record<string, any> || {};
if (bodyMeta.__agentEndBehavior && END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior]) {
  temporaryTool.defaultReaction = END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior];
}
if (bodyMeta.__staticResponse) {
  temporaryTool.staticResponse = bodyMeta.__staticResponse;
}
```

This ensures all three Ultravox entry points (`sync-ultravox-agent`, `make-outbound-call`, `handle-inbound-call`) produce identical, doc-compliant tool JSON — so tools trigger immediately when the user asks.

