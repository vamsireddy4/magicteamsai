

## Plan: Allow All Voices for Gemini Agents

The user confirms that Gemini supports custom/third-party voices (Ultravox, ElevenLabs, etc.) and wants the voice selector to work the same way regardless of AI provider — whatever voice is selected should be passed directly to Gemini.

### Current State
- The `AgentForm.tsx` UI shows a separate "Gemini native voices" dropdown when Gemini is selected, plus an Ultravox voice list below it — this is confusing with two dropdowns competing.
- The `gemini-voice-bridge` already passes the voice directly without filtering (whitelist exists but isn't used for filtering anymore).

### Changes

**1. Simplify voice UI in `AgentForm.tsx`**
- Remove the separate Gemini-only voice dropdown section (lines 352-369). When Gemini is selected, show the same single voice list as Ultravox — the full Ultravox voices list plus the Gemini native voices merged in.
- Add GEMINI_VOICES entries into the main voice search/select dropdown so users can pick from both Ultravox and Gemini native voices in one unified list.
- Keep the "Custom (ElevenLabs)" toggle working for both providers.

**2. Update bridge voice handling in `gemini-voice-bridge/index.ts`**
- Remove the unused `VALID_GEMINI_VOICES` Set (lines 4-8) since any voice is now accepted.
- Keep the existing pass-through logic (voice from agent DB goes straight to Gemini setup message).

### Result
One unified voice dropdown for all providers. Whatever the user selects gets passed to the call. No filtering, no separate dropdowns.

