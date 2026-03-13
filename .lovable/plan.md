

# Fix 404 Race Condition + Add Ultravox Agent Deletion

## Problem 1: Intermittent 404 on Agent Sync
The `sync-ultravox-agent` edge function queries the agent using both `agent_id` AND `user_id`. On new agent creation, there's a race condition: the frontend inserts the agent row, then immediately calls the sync function. The `getUser()` call in the edge function can occasionally be slow or return inconsistently, causing the query to miss the row.

**Fix:** Add a retry mechanism in the edge function. If the agent is not found on the first attempt, wait briefly and retry once. This handles both race conditions and transient DB replication delays.

## Problem 2: Deleting Agent Doesn't Remove Ultravox Agent
Currently `deleteAgent` only deletes from the local database, leaving orphaned agents on Ultravox.

**Fix:** Create a new `delete-ultravox-agent` edge function and call it before local deletion.

## Changes

### 1. Edit `supabase/functions/sync-ultravox-agent/index.ts`
- Add a retry with a 1-second delay when the agent query returns no results
- This handles the race condition where the DB row isn't visible yet

### 2. Create `supabase/functions/delete-ultravox-agent/index.ts`
- Accepts `{ agent_id }` in request body
- Authenticates the user
- Fetches the agent record to get `ultravox_agent_id`
- Calls `DELETE https://api.ultravox.ai/api/agents/{ultravox_agent_id}`
- Deletes the agent from the local database using service role
- Returns success even if Ultravox returns 404 (already deleted)

### 3. Edit `supabase/config.toml`
- Add `[functions.delete-ultravox-agent]` with `verify_jwt = false`

### 4. Edit `src/pages/Agents.tsx`
- Update `deleteAgent` to call the `delete-ultravox-agent` edge function instead of deleting directly via the client
- The edge function handles both Ultravox deletion and local DB deletion

