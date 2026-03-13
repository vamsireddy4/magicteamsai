

# Add Call Forwarding to Agent Configuration

## Overview
Add a "Call Forwarding" section below the Phone Number card in the Agent form, allowing users to configure multiple phone numbers that the AI agent can transfer calls to during a conversation.

## Changes

### 1. Database Migration
Create a new `call_forwarding_numbers` table:
- `id` (uuid, PK)
- `agent_id` (uuid, FK to agents, ON DELETE CASCADE)
- `user_id` (uuid, not null)
- `phone_number` (text, not null) — E.164 format
- `label` (text) — optional friendly name (e.g., "Sales", "Support Manager")
- `created_at` (timestamptz)

RLS policies: Users can only CRUD their own rows (matching `user_id = auth.uid()`).

### 2. Update Agent Form (`src/pages/AgentForm.tsx`)
Add a "Call Forwarding" card below the Phone Number card:
- List existing forwarding numbers with label + number + delete button
- "Add Number" row with label input, phone number input, and add button
- Fetch forwarding numbers on load when editing an agent
- Insert/delete rows directly via Supabase client

### 3. Update `handle-inbound-call/index.ts` and `make-outbound-call/index.ts`
- Fetch `call_forwarding_numbers` for the agent
- If forwarding numbers exist, inject a `transferCall` tool into the Ultravox tools array with the list of available numbers in the description
- Append instructions to the system prompt telling the agent when/how to use the transfer tool
- The tool will use Twilio's `calls.update()` API via a new edge function

### 4. Create `supabase/functions/transfer-call/index.ts`
New edge function that:
- Accepts `{ call_sid, destination_number, provider }` 
- For Twilio: Updates the call with TwiML `<Dial>` to forward to the destination
- For Telnyx: Uses Telnyx call control API to transfer
- No user auth needed (called by Ultravox as a tool during live calls)

### 5. Update `sync-ultravox-agent/index.ts`
- Fetch forwarding numbers for the agent
- If any exist, add the `transferCall` temporary tool to the Ultravox agent config
- Add forwarding instructions to the system prompt

### Files
- **New:** `call_forwarding_numbers` table (migration)
- **New:** `supabase/functions/transfer-call/index.ts`
- **Edit:** `src/pages/AgentForm.tsx` — add Call Forwarding UI card
- **Edit:** `supabase/functions/handle-inbound-call/index.ts` — inject transfer tool
- **Edit:** `supabase/functions/make-outbound-call/index.ts` — inject transfer tool
- **Edit:** `supabase/functions/sync-ultravox-agent/index.ts` — sync transfer tool

