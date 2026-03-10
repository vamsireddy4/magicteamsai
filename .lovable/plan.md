

## Plan: Fetch Ultravox Voices and Models Dynamically

### Problem
The agent form currently hardcodes 8 voice names. These may not match actual Ultravox voices, and users can't see all available options or features.

### Approach
1. **Create an edge function `list-ultravox-voices`** that proxies requests to the Ultravox API (`GET /api/voices` and `GET /api/models`) using the stored `ULTRAVOX_API_KEY` secret. This keeps the API key server-side.

2. **Update `AgentForm.tsx`** to fetch voices dynamically from the edge function on mount, replacing the hardcoded `VOICES` array. Display voice name, language, and description in the select dropdown.

3. **Show available models** from the `/api/models` endpoint, allowing users to select which Ultravox model to use (currently hardcoded to `fixie-ai/ultravox-v0.7`).

4. **Add a `model` column** to the `agents` table so the selected model is persisted per agent.

5. **Update edge functions** (`make-outbound-call`, `handle-inbound-call`) to use `agent.model` instead of the hardcoded model string.

### Technical Details

**New edge function: `supabase/functions/list-ultravox-voices/index.ts`**
- `GET` handler that calls `https://api.ultravox.ai/api/voices` and `https://api.ultravox.ai/api/models`
- Returns combined JSON `{ voices: [...], models: [...] }`
- Uses `ULTRAVOX_API_KEY` from secrets
- Requires auth (validates JWT)

**Database migration**
- `ALTER TABLE agents ADD COLUMN model text NOT NULL DEFAULT 'fixie-ai/ultravox-v0.7';`

**AgentForm.tsx changes**
- Fetch voices/models on mount via `supabase.functions.invoke("list-ultravox-voices")`
- Replace hardcoded `VOICES` with dynamic list showing voice name + language
- Add model selector dropdown
- Include `model` in form state and save payload

**Edge function updates**
- `make-outbound-call` and `handle-inbound-call`: use `agent.model` instead of hardcoded `"fixie-ai/ultravox-v0.7"`

