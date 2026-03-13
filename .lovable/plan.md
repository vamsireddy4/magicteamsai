

## Plan: Rename "Ultravox" to "MagicTeams" in UI

**Single file change**: `src/pages/AgentForm.tsx`

Change the `AI_PROVIDERS` array label from `"Ultravox"` to `"MagicTeams"` (line ~80). The underlying value `"ultravox"` stays the same — this is purely a display label change.

```
Before: { value: "ultravox", label: "Ultravox" }
After:  { value: "ultravox", label: "MagicTeams" }
```

No backend, database, or logic changes.

