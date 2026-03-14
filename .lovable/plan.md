

# Fix Sarvam AI Voice Bridge — 3 Bugs Found

The logs reveal exactly why the agent isn't responding. There are three broken API integrations:

## Issues Found

### 1. Chat API URL is wrong (404 error)
- **Current**: `https://api.sarvam.ai/v2/chat/completions`
- **Correct**: `https://api.sarvam.ai/v1/chat/completions`

### 2. TTS voice names are invalid (400 error)
The voices `meera`, `arvind`, `amol`, `kalpana`, `diya`, `neel`, `misha` don't exist in Sarvam's API. The valid speakers are: `anushka`, `abhilash`, `manisha`, `vidya`, `arya`, `karun`, `hitesh`, `aditya`, `ritu`, `priya`, `neha`, `rahul`, `pooja`, `rohan`, `simran`, `kavya`, `amit`, `dev`, `ishita`, `shreya`, `shubh`, `advait`, `amelia`, `sophia`, `anand`, `tanya`, `tarun`, `sunny`, `mani`, `gokul`, `vijay`, `shruti`, `suhani`, `mohit`, `kavitha`, `rehan`, `soham`, `rupali`, etc.

Only `shubh` from the current list is valid.

### 3. STT WebSocket keeps disconnecting (code=0)
- **Current URL**: `wss://api.sarvam.ai/speech-to-text-translate/socket`
- **Correct URL**: `wss://api.sarvam.ai/speech-to-text/ws`
- Auth header `Api-Subscription-Key` must be passed. Since Deno WebSocket doesn't support custom headers, we pass it as a query parameter (the Sarvam SDK does this too).
- Query param should be `language-code` (hyphenated), not `language_code`
- Need to add `model=saaras:v3` and `sample_rate=8000` query params
- Remove the separate JSON config message — Sarvam STT uses query params for config, not a JSON config frame

## Changes

### File 1: `supabase/functions/sarvam-voice-bridge/index.ts`
- Fix `SARVAM_CHAT_URL` to `/v1/chat/completions`
- Fix `SARVAM_STT_WS_BASE` to `wss://api.sarvam.ai/speech-to-text/ws`
- Update `connectSTT()` to use correct query params: `language-code`, `model=saaras:v3`, `sample_rate=8000`, `input_audio_codec=mulaw`
- Remove the JSON config message sent on STT open (not needed)
- Add `Authorization: Bearer` header for chat completions (Sarvam also accepts this)

### File 2: `src/pages/AgentForm.tsx`
- Replace `SARVAM_VOICES` with actual valid Sarvam speakers: `anushka`, `manisha`, `vidya`, `arya`, `priya`, `kavya`, `shreya`, `shruti` (female), `abhilash`, `karun`, `hitesh`, `rahul`, `amit`, `dev`, `shubh`, `advait` (male)

