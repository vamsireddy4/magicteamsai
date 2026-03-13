

## Plan: Rename "ultravox" to "MagicTeams" in All UI-Visible Text

**No backend changes.** Only display labels, placeholders, and visible text.

### File 1: `src/pages/AgentForm.tsx`
- **Model dropdown items**: When rendering model names in `<SelectItem>`, replace `fixie-ai/` prefix and `ultravox-` with `magicteams-` in the display text (e.g. `fixie-ai/ultravox-v0.7` → `MagicTeams v0.7`). The underlying `value` stays unchanged.
- **Placeholder** (line 260): Change `"fixie-ai/ultravox-v0.7"` → `"MagicTeams v0.7"`

### File 2: `src/pages/Auth.tsx`
- **Line 114**: Change `"Powered by Ultravox AI"` → `"Powered by MagicTeams AI"`

