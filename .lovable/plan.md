

# Plan: Add Sarvam AI as a Voice Agent Provider

## Overview

Sarvam AI provides WebSocket-based STT (`wss://api.sarvam.ai/speech-to-text/ws`), WebSocket-based TTS (`bulbul:v3` with mulaw output support), and OpenAI-compatible Chat Completions (`https://api.sarvam.ai/chat/completions`). We can build a voice bridge similar to the existing `gemini-voice-bridge` that pipes Twilio/Telnyx audio through Sarvam's STT → Chat Completion → TTS pipeline.

## Changes Required

### 1. Create `sarvam-voice-bridge` edge function
**New file:** `supabase/functions/sarvam-voice-bridge/index.ts`

A WebSocket-based bridge (same pattern as `gemini-voice-bridge`) that:
- Receives mulaw audio from Twilio/Telnyx via WebSocket
- Streams it to Sarvam STT WebSocket (`wss://api.sarvam.ai/speech-to-text/ws`) for real-time transcription
- When a complete utterance is detected, sends it to Sarvam Chat Completions (`https://api.sarvam.ai/chat/completions`) with the agent's system prompt
- Streams the response text to Sarvam TTS WebSocket with `output_audio_codec: "mulaw"` config
- Sends TTS audio chunks back to Twilio/Telnyx in real-time
- Loads agent config, knowledge base, and tools from database (same as gemini bridge)
- Supports custom tool execution (calendar, HTTP tools)

Key Sarvam API details:
- **STT**: `wss://api.sarvam.ai/speech-to-text/ws` with `Api-Subscription-Key` header, `language-code` query param
- **Chat**: `https://api.sarvam.ai/chat/completions` with models like `sarvam-105b`, `sarvam-30b`
- **TTS**: WebSocket streaming with `bulbul:v3` model, supports `mulaw` codec, voices like `shubh`, `arvind`, `meera`, etc.

### 2. Update `supabase/config.toml`
Add `[functions.sarvam-voice-bridge]` with `verify_jwt = false` (telephony providers connect directly).

### 3. Request `SARVAM_API_KEY` secret
Use the `add_secret` tool to ask the user for their Sarvam AI API subscription key.

### 4. Update Agent Form UI (`src/pages/AgentForm.tsx`)
- Add `sarvam` to `AI_PROVIDERS` array: `{ value: "sarvam", label: "Sarvam AI" }`
- Add `SARVAM_MODELS` constant: `sarvam-105b`, `sarvam-30b`, `sarvam-105b-32k`, `sarvam-m`
- Add `SARVAM_VOICES` constant with available Sarvam TTS speakers
- Update the provider change handler to set default Sarvam model/voice
- Update the voice/model selector to show Sarvam options when `ai_provider === "sarvam"`
- Skip Ultravox sync for Sarvam agents (already handled — sync only runs for `ultravox`)

### 5. Update outbound call functions
**Files:** `make-outbound-call/index.ts`, `handle-inbound-call/index.ts`, `process-scheduled-calls/index.ts`, `run-campaign/index.ts`

Add a `sarvam` branch alongside the existing `gemini` and `ultravox` branches:
- Construct the bridge WebSocket URL: `${supabaseUrl}/functions/v1/sarvam-voice-bridge?agent_id=${agent.id}` (converted to `wss://`)
- For Twilio: generate TwiML with `<Stream>` pointing to the bridge
- For Telnyx: store the bridge URL in `telnyx_call_state` for post-answer streaming

This follows the exact same pattern as the Gemini provider path — no new telephony logic needed.

### 6. Update Telnyx webhook
**File:** `handle-telnyx-webhook/index.ts`

No changes needed — the existing Telnyx webhook already reads `join_url` from `telnyx_call_state` and starts streaming. The Sarvam bridge URL will work identically to the Gemini bridge URL.

## Technical Details

- Sarvam STT supports 22+ Indian languages plus English with auto-detection (`unknown` language code)
- TTS supports mulaw codec natively, which is what Twilio/Telnyx use — no audio conversion needed
- Chat completion API is OpenAI-compatible format, making prompt/tool integration straightforward
- The `agent.language_hint` field can map directly to Sarvam's BCP-47 language codes (e.g., `hi-IN`, `ta-IN`)

