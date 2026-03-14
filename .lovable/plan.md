
Goal: make Sarvam calls reliably speak back (not just connect) for your current flow.

What I found from current logs/code
- STT never establishes: repeated `400 Bad Request` on `wss://api.sarvam.ai/speech-to-text/ws`.
- Current STT auth is sent as query param (`api-subscription-key=...`), while Sarvam WS docs require `Api-Subscription-Key` header.
- Telnyx stream starts, but bridge logs `provider=twilio` and `sid=` (empty), so outbound audio routing is likely inconsistent.
- `Chat API 504` appears during greeting path; even when TTS is generated, delivery may fail if stream ID/provider mapping is wrong.

Implementation plan

1) Fix STT handshake/auth in `sarvam-voice-bridge`
- Replace STT client connect logic to use an outbound WebSocket client that supports custom headers (send `Api-Subscription-Key` in header).
- Keep query params only for STT config (`language-code`, `model`, `mode`, `sample_rate`, `input_audio_codec`, optional VAD flags).
- Keep audio message format as JSON (`audio`, `encoding`, `sample_rate`) after connect.
- Add explicit one-time logging for handshake mode used and server close reason.

2) Make telephony stream routing deterministic (Telnyx + Twilio)
- Pass `provider` in bridge URL from all Sarvam call entry points:
  - `make-outbound-call`
  - `handle-inbound-call`
  - `run-campaign`
  - `process-scheduled-calls`
- In bridge, read provider from query first; event-based detection becomes fallback only.
- Expand stream ID extraction to all observed payload shapes (`start.streamSid`, `start.stream_id`, top-level variants).
- For outbound media frames, emit provider-specific payload shape and include stream identifier fields expected by each provider.

3) Add response reliability for greeting + turns
- Add timeout + retry for Sarvam Chat completion on 5xx/504.
- If chat times out, send a deterministic fallback greeting immediately (so caller hears voice even during upstream delay).
- Keep `ttsInFlight` guard and add a short queue so transcripts arriving during TTS are processed after current turn.

4) Configuration hardening
- Add `[functions.sarvam-voice-bridge] verify_jwt = false` in `supabase/config.toml` (telephony websocket source is unauthenticated by design).
- Keep existing in-function safety checks for missing `agent_id` and secret availability.

5) Validation after implementation
- Place one outbound Sarvam call via Telnyx and confirm logs show:
  - `STT WS connected` (no 400 loop)
  - non-empty stream identifier captured
  - transcript events received
  - chat response generated
  - TTS audio sent on correct provider path
- Verify audible behavior end-to-end: initial greeting + response after you speak.
- Repeat once with Twilio (if configured) to confirm no regression.

Technical notes (important)
- This is not a database/RLS issue; no schema migration is required.
- Primary blocker is WS auth/protocol mismatch, then provider stream-shape mismatch.
- I’ll keep the fix backward-compatible with both Twilio JSON media and Telnyx websocket/bidirectional variants so one provider’s fix does not break the other.
