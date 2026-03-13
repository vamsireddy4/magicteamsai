

## Plan: Remove AI Summary Button, Display Ultravox Summary Automatically

### What's changing

The sync-call-data edge function already fetches the summary from Ultravox and saves it to the `summary` column. The frontend still has a "Generate Summary" button that calls the `summarize-call` edge function (Gemini). We need to:

1. **`src/pages/CallLogs.tsx`** — Remove the "Generate Summary" button and the `summarizeCall` function. Instead, simply display `call.summary` if it exists (already fetched from Ultravox during sync). Remove the `summarizing` state, `Loader2` import (if unused), and the `summarize-call` invocation. The AI Summary section becomes a read-only display that shows whenever `selectedCall.summary` exists.

2. **`supabase/functions/summarize-call/index.ts`** — Delete this edge function entirely since it's no longer needed.

3. **`supabase/functions/sync-call-data/index.ts`** — Fix the bug on line 237 where `finalStatus` is referenced but never defined. It should be `const finalStatus = (updateData.status as string) ?? call.status;` before the log line. Also expand the sync query filter to include calls missing summaries (`summary.is.null`) so existing completed calls without summaries get synced too.

### Summary of changes

| File | Action |
|------|--------|
| `src/pages/CallLogs.tsx` | Remove summarize button/logic, show summary as read-only |
| `supabase/functions/summarize-call/index.ts` | Delete |
| `supabase/functions/sync-call-data/index.ts` | Fix `finalStatus` bug, add `summary.is.null` to sync filter |

