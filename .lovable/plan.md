

## Plan: AI-Powered Knowledge Base Content Extraction

### What We're Building
When a user adds a URL or uploads a file (PDF, TXT, DOC, DOCX, MD) to the knowledge base, a backend function will use Gemini AI to extract and structure the content. This extracted content gets stored in the `content` column and is automatically used by agents during calls.

### Changes

#### 1. Database Migration
Add `processing_status` column to `knowledge_base_items`:
- Type: `text`, default `'pending'`, nullable
- Values: `pending`, `processing`, `completed`, `failed`

#### 2. New Edge Function: `supabase/functions/process-knowledge/index.ts`
- Accepts `{ knowledge_item_id: string }` via POST
- Uses `SUPABASE_SERVICE_ROLE_KEY` to read the item and bypass RLS
- **For URLs**: Fetches HTML via `fetch()`, strips tags, sends to Gemini AI (`google/gemini-2.5-flash` via `LOVABLE_API_KEY`) with prompt: "Extract and structure all key information from this webpage content into clean, organized text that an AI agent can reference during phone calls"
- **For Files**: Downloads from `knowledge-documents` storage bucket, reads content (TXT/MD as text directly; PDF/DOC/DOCX as best-effort text), sends to Gemini AI for extraction and structuring
- Updates `knowledge_base_items.content` with extracted text and sets `processing_status = 'completed'`
- On failure, sets `processing_status = 'failed'`
- Content truncated to ~15K characters to keep system prompts manageable
- Add to `config.toml` with `verify_jwt = false`

#### 3. Update `src/components/agent-tabs/AgentKnowledgeBase.tsx`
- After inserting a URL or file knowledge item, call `process-knowledge` edge function in background
- Show processing status badge on items (`Processing...`, `Completed`, `Failed`)
- Use realtime subscription (already exists) to auto-refresh when processing completes

#### 4. Update `src/pages/KnowledgeBase.tsx`
- Same changes: trigger `process-knowledge` after insert, show status badges

#### 5. Update Call Functions (minor tweak)
- In `make-outbound-call` (and similar functions), adjust KB injection logic: if `item.content` exists, use it; skip the "Refer to: URL" fallback since content will now be populated. Currently the code appends both `content` and `website_url` — change to prefer `content` when available.

### How It Works End-to-End
```text
User adds URL/File → Insert row (status=pending) → Call process-knowledge edge function
  → Edge function fetches URL HTML or downloads file from storage
  → Strips HTML / reads file text
  → Sends to Gemini AI: "Extract key information..."
  → Stores extracted text in content column, status=completed
  → Realtime subscription refreshes UI

During call → KB items fetched → item.content (now populated with AI-extracted text) injected into system prompt
```

### No New Secrets Needed
`LOVABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL` are already configured.

