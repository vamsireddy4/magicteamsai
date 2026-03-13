

# Fix Ultravox Agent Sync: callTemplate Structure, Tools, Knowledge Base

## Problem
The `sync-ultravox-agent` edge function sends configuration fields (`systemPrompt`, `model`, `voice`, `temperature`, `selectedTools`) as flat top-level properties. The Ultravox Create Agent API requires these nested inside a `callTemplate` object. Ultravox silently ignores unknown top-level fields and creates an empty/unconfigured agent shell.

## Root Cause (from Ultravox docs)
The correct Ultravox Create Agent body structure is:
```text
{
  "name": "Agent_Name",
  "callTemplate": {
    "systemPrompt": "...",
    "model": "fixie-ai/ultravox-v0.7",
    "voice": "terrence",
    "temperature": 0.7,
    "languageHint": "en",
    "maxDuration": "300s",
    "selectedTools": [
      { "temporaryTool": { ... } }
    ]
  }
}
```

## Changes

### 1. Fix `supabase/functions/sync-ultravox-agent/index.ts`

**Wrap all config fields inside `callTemplate`:**
- Move `systemPrompt`, `model`, `voice`, `temperature`, `languageHint`, `maxDuration`, and `selectedTools` from the top level into a `callTemplate` object
- Keep only `name` at the top level
- Apply this structure to both the POST (create) and PATCH (update) API calls

**Custom tools** (already built as `temporaryTool` objects) will now correctly land inside `callTemplate.selectedTools` where Ultravox expects them.

**Knowledge base** content is already appended to the `systemPrompt` string -- this will now be correctly sent inside `callTemplate.systemPrompt`.

**Appointment tools** (calendar check/book) are already built as `temporaryTool` objects and will also land correctly inside `callTemplate.selectedTools`.

**Add static parameters for custom tools:** Include `http_headers` and `http_body_template` from the `agent_tools` table as `staticParameters` on each tool, so custom tool headers and body templates are sent to Ultravox.

### 2. Fix `src/pages/AgentForm.tsx` -- Rollback on sync failure

When creating a **new** agent, if the Ultravox sync fails:
- Delete the newly created agent from the local database
- Show an error toast with the failure reason
- Do NOT navigate away -- keep the user on the form so they can retry

When **updating** an existing agent, if sync fails:
- Show an error toast but keep the local changes (agent already existed)

### Files to modify
- `supabase/functions/sync-ultravox-agent/index.ts` -- nest config in `callTemplate`
- `src/pages/AgentForm.tsx` -- rollback new agent on sync failure

