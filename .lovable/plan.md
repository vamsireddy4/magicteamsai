

## Plan: Fix Ultravox Tool Sync + Build Gemini/Sarvam Tool Execution from Scratch

### Current State Analysis

**Ultravox** — The tool JSON format in `sync-ultravox-agent`, `make-outbound-call`, and `handle-inbound-call` is already correct per Ultravox docs:
- `temporaryTool` with `modelToolName`, `description`, `dynamicParameters` (with `schema`), `staticParameters` (with `value`), `automaticParameters` (with `knownValue`), and `http` block
- Auth via `x-ultravox-tool-key` header as a static parameter — works because `check-calendar-availability` and `book-calendar-appointment` already validate it
- The Ultravox JSON is **structurally correct** — no format changes needed

**However, there's one issue**: The `book-calendar-appointment` endpoint does NOT read `provider` from the request body. It reads `integration.provider` from the DB. So the `provider` static parameter is harmless but unnecessary. The real issue would be if `integration_id` isn't being passed — but it IS correctly in `staticParameters`.

**Gemini bridge** — Already has:
- `loadAgent()` that fetches tools, KB, appointment tools, forwarding numbers, webhooks
- `buildFunctionDeclarations()` that registers tools with Gemini
- `executeToolCall()` that handles calendar, transfer, and custom tools
- Webhook firing on start/end

**Sarvam bridge** — Already has:
- `loadAgent()` with all data fetching
- Tool prompt injection with `[TOOL_CALL:name|{args}]` pattern
- `executeToolCall()` for calendar, transfer, custom tools
- `extractToolCall()` regex parser
- Tool loop in `chatCompletion()`
- Webhook firing

### What's Actually Wrong

After thorough review, the implementations look structurally complete. The likely issues are:

1. **Ultravox `sync-ultravox-agent` webhooks**: Webhooks are POSTed to `api.ultravox.ai/api/webhooks` but this creates **new** webhooks each time sync runs (no idempotency/cleanup). Duplicate webhooks accumulate.

2. **Sarvam tool regex is too strict**: The regex `\[TOOL_CALL:(\w+)\|(\{[^}]*\})\]` fails on nested JSON (e.g. `{"key":"value with }"}`) — the `[^}]*` stops at the first `}`.

3. **Gemini custom tool body construction**: `executeCustomTool` uses template replacement `{{key}}` but the dynamic parameters from Gemini are just key-value args — the body template may not have `{{placeholders}}`. Need to merge args directly into the body.

4. **Sarvam custom tool body construction**: Same issue — uses `{{key}}` replacement but custom tool bodies may not use template placeholders.

5. **Missing `provider` field in booking request body** — `book-calendar-appointment` doesn't read `provider` from the body, so this is fine. But `check-calendar-availability` DOES read `provider` from the body (line 46). For Gemini/Sarvam bridges, the `provider` is fetched from `cal.provider` — this works correctly.

### Implementation Plan

#### 1. Fix Ultravox Webhook Sync (sync-ultravox-agent)
- Before creating new webhooks, **delete existing Ultravox webhooks** for this agent to avoid duplicates
- Use `GET /api/webhooks?agentId=X` to list, then `DELETE` each before re-creating

#### 2. Fix Sarvam Tool Call Regex
- Replace `[^}]*` with a balanced brace parser to handle nested JSON
- Or use a simpler approach: match `[TOOL_CALL:name|` then find the matching `}]` by counting braces

#### 3. Fix Custom Tool Execution in Both Bridges
- In both `gemini-voice-bridge` and `sarvam-voice-bridge`, update `executeCustomTool` / custom tool execution to:
  - Build the request body by **merging** dynamic args with the body template (not just replacing `{{placeholders}}`)
  - Include static body template values alongside dynamic args
  - Remove internal metadata keys (`__agentEndBehavior`, `__staticResponse`)

#### 4. Ensure Gemini Has Complete Tool Parameter Mapping
- In `buildFunctionDeclarations`, for custom tools, only include `dynamic` parameters (skip `automatic` ones since Gemini doesn't have knownValue support)
- For custom tools with automatic params like `call.id`, pass `callSid` automatically when executing

#### 5. Ensure Sarvam Tool Descriptions Include All Dynamic Params
- The current prompt injection for custom tools shows params but uses generic format — ensure the description includes all dynamic parameter names and types correctly

### Files to Modify

1. **`supabase/functions/sync-ultravox-agent/index.ts`** — Fix webhook sync to be idempotent (delete old, create new)
2. **`supabase/functions/sarvam-voice-bridge/index.ts`** — Fix regex, fix custom tool body construction, improve param handling  
3. **`supabase/functions/gemini-voice-bridge/index.ts`** — Fix custom tool body construction, add automatic param injection

### Technical Details

**Balanced brace parser for Sarvam**:
```typescript
function extractToolCall(text: string) {
  const prefix = /\[TOOL_CALL:(\w+)\|/;
  const match = text.match(prefix);
  if (!match) return null;
  const startIdx = match.index! + match[0].length;
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  const jsonStr = text.substring(startIdx, endIdx + 1);
  const args = JSON.parse(jsonStr);
  const cleanText = text.replace(text.substring(match.index!, endIdx + 2), "").trim();
  return { toolName: match[1], args, cleanText };
}
```

**Custom tool body merge (both bridges)**:
```typescript
// Instead of just template replacement, merge args into body
let bodyObj: Record<string, any> = {};
if (tool.http_body_template) {
  bodyObj = { ...tool.http_body_template };
  // Remove internal metadata
  delete bodyObj.__agentEndBehavior;
  delete bodyObj.__staticResponse;
}
// Merge dynamic args
for (const [key, value] of Object.entries(args)) {
  bodyObj[key] = value;
}
body = JSON.stringify(bodyObj);
```

**Webhook idempotency for Ultravox**:
```typescript
// Before creating webhooks, clean up existing ones for this agent
const listRes = await fetch(`https://api.ultravox.ai/api/webhooks?agentId=${newUltravoxAgentId}`, {
  headers: { "X-API-Key": ultravoxApiKey },
});
if (listRes.ok) {
  const existing = await listRes.json();
  for (const wh of existing.results || []) {
    await fetch(`https://api.ultravox.ai/api/webhooks/${wh.webhookId}`, {
      method: "DELETE",
      headers: { "X-API-Key": ultravoxApiKey },
    });
  }
}
```

