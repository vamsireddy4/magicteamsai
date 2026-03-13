

# Redesign Create Tool Dialog — Multi-Step Wizard with Simple Parameter Columns

## Overview
Replace the current single-scroll dialog with a multi-step wizard (inspired by the Ultravox screenshots), using a left sidebar stepper and right content panel. Replace the JSON schema textarea with simple Type dropdown + Description input columns. White/light theme for the dialog.

## Changes

### `src/components/custom-tools/CreateToolDialog.tsx` — Full rewrite

**1. Multi-step wizard layout (4 steps matching screenshots):**
- **Info** — Tool Name (required) + Description textarea
- **Integration** — Agent selector, Custom Endpoint URL (required), HTTP Method dropdown, Timeout input
- **Parameters** — Dynamic + Static parameters with simple column inputs
- **Advanced** — (placeholder for future: agent end behavior, static response toggle)

**2. Left sidebar stepper** showing step labels with Complete/Incomplete/Empty status badges based on field validation.

**3. Replace JSON Schema with columns for Dynamic Parameters:**
- Remove `schema: string` from `DynamicParam` interface
- Add `type: string` (dropdown: string, number, integer, boolean) and `description: string` (text input)
- Layout: Name | Type | Location | Required checkbox | Description — all as simple form fields in a row
- On save, auto-build schema object: `{ type: p.type, description: p.description }`

**4. Static Parameters remain the same** (Name, Location, Value columns — no schema needed).

**5. White/light theme for dialog content:**
- White background on the dialog panel
- Dark text, light borders
- Sections use subtle gray backgrounds

**6. handleSave conversion** stays compatible — builds the same `parameters` JSON array with `{ name, location, required, schema: { type, description } }` that the edge functions already read (line 133 of sync-ultravox-agent: `type: p.type || "string", description: p.description || ""`).

### Files to edit
- `src/components/custom-tools/CreateToolDialog.tsx` — full rewrite to multi-step wizard with simple columns

No backend or edge function changes needed — the stored parameters format is already compatible.

