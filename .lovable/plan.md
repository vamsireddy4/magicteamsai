

# Replace JSON Schema with Simple Columns in Custom Tools

## Problem
The current Dynamic Parameters UI requires users to write raw JSON schema (e.g. `{"type": "string", "description": "..."}`), which is confusing. The user wants simple input columns instead.

## Solution
Replace the Schema (JSON) textarea with two simple fields: **Type** (dropdown: string, number, boolean, integer) and **Description** (text input). On save, auto-convert these into the proper JSON schema object that Ultravox expects.

### Changes to `src/components/custom-tools/CreateToolDialog.tsx`

**Dynamic Parameters — replace schema textarea with columns:**
- Change `DynamicParam` interface: replace `schema: string` with `type: string` and `description: string`
- Replace the Schema (JSON) textarea with:
  - **Type** — Select dropdown with options: `string`, `number`, `integer`, `boolean`
  - **Description** — Text input for describing the parameter
- Layout becomes a 3-column grid row: Name | Location | Type, then Description below
- On save, auto-build schema: `{ type: p.type, description: p.description }`

**Static Parameters — no schema needed (already just name/location/value), no changes.**

**handleSave conversion:**
```typescript
// Before: JSON.parse(p.schema)
// After:
{ type: p.type, description: p.description }
```

This produces the exact same schema object that the edge functions expect when building Ultravox `dynamicParameters` (e.g. `{ type: "string", description: "Date in YYYY-MM-DD format" }`).

### Files to edit
- `src/components/custom-tools/CreateToolDialog.tsx` — replace schema JSON with type+description columns

No backend changes needed — the stored `parameters` JSON array already accepts any schema object, and the edge functions already read `p.schema` as-is.

