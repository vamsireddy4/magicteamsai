

## Plan: Campaign Outcomes — Live Updates, Retry Tracking, Transcript & AI Summary Columns

### What changes

**1. Remove "Sync & Refresh" button — replace with realtime subscription**
- Remove the Sync & Refresh button from both campaign list and detail views
- Add a Supabase Realtime subscription on `call_logs` and `call_outcomes` tables so the UI auto-updates when calls complete
- Enable realtime on `call_logs` table via migration (`ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs`)
- On any `INSERT` or `UPDATE` event, re-fetch data automatically

**2. Show only campaign-specific contacts' calls (already working), plus retry tracking**
- Track attempt number by counting how many call_logs exist for the same recipient_number within the campaign's contacts
- Display attempt number in a new "Attempt" column — attempts > 1 show as "Retry #N"

**3. Add Transcript column to the table**
- Add a "Transcript" column that shows a truncated preview (first ~80 chars) of the formatted transcript
- Clicking a row still opens the full detail dialog with complete transcript

**4. Add AI Summary column**
- Add an "AI Summary" column to the table
- For each call with a transcript, show a "Generate" button or the summary text if already generated
- On click, invoke the existing `summarize-call` edge function with the call's ID
- Store the summary locally in state (keyed by call log ID) so it persists during the session
- Show a loading spinner while generating

### Database Migration
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;` (if not already added)

### Files to modify
- `src/components/campaigns/OutcomesTab.tsx` — all UI changes (remove sync button, add realtime, add columns, add AI summary invocation)

### Technical details
- Realtime channel subscribes to `postgres_changes` on `call_logs` table, filtering by `INSERT` and `UPDATE` events
- AI summary uses existing `summarize-call` edge function — already accepts `call_id` and returns `{ summary }`
- Summary state stored as `Record<string, string>` mapped by call log ID
- Attempt tracking: group `campCallLogs` by `recipient_number`, sort by `started_at`, assign attempt index

