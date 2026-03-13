

## Plan: Sync Custom Tools with Ultravox on Creation

### Problem
Currently, when a custom tool is created in the Create Tool dialog, it only saves to the database. It does **not** trigger the `sync-ultravox-agent` edge function, so the tool is never registered with Ultravox until the agent is manually re-saved from the Agent Form.

Additionally, the `sync-ultravox-agent` function doesn't handle **Automatic parameters** — it lumps them with Static parameters and doesn't use the Ultravox `automaticParameters` array with `knownValue` mappings.

### Changes

#### 1. CreateToolDialog — Trigger sync after tool creation
After successfully inserting the tool into `agent_tools`, call `sync-ultravox-agent` with the `agent_id` so Ultravox immediately picks up the new tool.

Also store Automatic parameters separately in the DB (currently they're mixed into `http_body_template` alongside Static params). We'll save them in the `parameters` array with a `paramType: "automatic"` field so the edge function can distinguish them.

Save advanced settings (`agentEndBehavior`, `staticResponse`) into `http_body_template` metadata or a dedicated field.

#### 2. sync-ultravox-agent — Support all 3 parameter types
Update the edge function to:
- Parse `dynamicParameters` from `parameters` array (existing, works)
- Parse `automaticParameters` from `parameters` array (new — look for `paramType === "automatic"`)
- Map UI known values to Ultravox enums:
  - `call.id` → `KNOWN_PARAM_CALL_ID`
  - `call.stage_id` → `KNOWN_PARAM_CALL_STAGE_ID`  
  - `call.state` → `KNOWN_PARAM_CALL_STATE`
  - `call.conversation_history` → `KNOWN_PARAM_CONVERSATION_HISTORY`
  - `call.sample_rate` → `KNOWN_PARAM_CALL_SAMPLE_RATE`
- Build the `automaticParameters` array in the Ultravox tool definition
- Keep existing static parameter logic from `http_headers`/`http_body_template`

#### 3. Also sync on tool delete and toggle
In `AgentCustomTools.tsx`, after deleting or toggling a tool's active status, also call `sync-ultravox-agent` so Ultravox stays in sync.

### File Changes

**`src/components/custom-tools/CreateToolDialog.tsx`**
- In `handleSave`: Save automatic params into `parameters` array with `{ paramType: "automatic", name, location, knownValue }` 
- After successful insert, invoke `sync-ultravox-agent` edge function
- Save `agentEndBehavior` and `staticResponse` config in the tool data

**`src/components/agent-tabs/AgentCustomTools.tsx`**
- After `handleDelete` and `toggleActive`, invoke `sync-ultravox-agent`

**`supabase/functions/sync-ultravox-agent/index.ts`**
- In the custom HTTP tools section, add `automaticParameters` array construction
- Map `knownValue` strings to Ultravox enum values
- Include `automaticParameters` in the `temporaryTool` definition alongside existing `dynamicParameters` and `staticParameters`

### Data Flow
```text
Create Tool Dialog
  ├─ Insert into agent_tools table
  │   parameters: [
  │     { paramType: "dynamic", name, location, schema, required },
  │     { paramType: "automatic", name, location, knownValue },
  │   ]
  │   http_headers: { static header params }
  │   http_body_template: { static body params }
  │
  └─ Invoke sync-ultravox-agent(agent_id)
       └─ Reads agent_tools
       └─ Builds Ultravox temporaryTool:
            ├─ dynamicParameters: [...]
            ├─ staticParameters: [...]  (from headers/body)
            └─ automaticParameters: [{ name, location, knownValue }]
```

