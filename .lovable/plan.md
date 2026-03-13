

# Fix Parameter Data Flow Between UI and Ultravox Sync

## Problem
There's a mismatch between how the UI saves parameters and how `sync-ultravox-agent` reads them:

**UI saves** (line 158-163 of CreateToolDialog):
```json
{ "name": "date", "location": "body", "required": true, "schema": { "type": "string", "description": "Date" } }
```

**Edge function reads** (line 130-135 of sync-ultravox-agent):
```typescript
schema: { type: p.type || "string", description: p.description || "" }
```
It reads `p.type` and `p.description` at the top level — but they're nested inside `p.schema`. So it always falls back to defaults (`"string"`, `""`).

Also:
- The edge function hardcodes `location: "PARAMETER_LOCATION_BODY"` and ignores the stored location value.
- The `{ }` prefix on "Dynamic" label (line 216) still needs removing.

## Changes

### 1. `src/components/custom-tools/CreateToolDialog.tsx` — line 216
Remove `{ "{ } " }` from the Dynamic label text.

### 2. `supabase/functions/sync-ultravox-agent/index.ts` — lines 128-136
Update the dynamic parameter reading to handle both formats (new `schema` object and legacy flat fields), and use the stored location:

```typescript
for (const p of tool.parameters as any[]) {
  const schema = p.schema || { type: p.type || "string", description: p.description || "" };
  const loc = p.location === "header" ? "PARAMETER_LOCATION_HEADER"
    : p.location === "query" ? "PARAMETER_LOCATION_QUERY"
    : "PARAMETER_LOCATION_BODY";
  dynamicParameters.push({
    name: p.name,
    location: loc,
    schema,
    required: !!p.required,
  });
}
```

This ensures:
- `schema.type` and `schema.description` are passed correctly to Ultravox
- Location (body/header/query) is respected instead of always defaulting to body
- Backward compatible with any older tools stored with flat `type`/`description`

### Files
- `src/components/custom-tools/CreateToolDialog.tsx` — remove `{ }` from Dynamic label
- `supabase/functions/sync-ultravox-agent/index.ts` — fix parameter schema + location reading

