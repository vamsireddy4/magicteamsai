
Goal: make Sarvam calls reliably speak on both Twilio and Telnyx (no Twilio “application error”, no silent Telnyx calls).

1) Confirmed root causes from current logs/code
- Twilio path is not reaching `sarvam-voice-bridge` at all (no WS 101 entry for `provider=twilio`), while `make-outbound-call` reports call SID created.
- In `make-outbound-call`, Sarvam Twilio TwiML uses a `url="...?...&provider=twilio"` attribute directly; this is XML-fragile and is the most likely trigger for Twilio’s “application error”.
- Telnyx path does connect and STT works (multiple Telugu transcripts are logged), but chat repeatedly times out (15s × retries), so first reply arrives too late (after caller hangup). This is why user hears no response.

2) Fix Twilio stream setup (primary blocker for “application error”)
- File: `supabase/functions/make-outbound-call/index.ts`
- Build Sarvam Twilio stream URL without query params.
- Pass both `agent_id` and `provider=twilio` via `<Parameter>` tags (same robust pattern used elsewhere).
- Add XML-safe attribute escaping helper for all TwiML URLs/parameter values.
- Keep status callback, but ensure this path always emits valid TwiML.

3) Fix Sarvam bridge turn latency so Telnyx gets voice before hangup
- File: `supabase/functions/sarvam-voice-bridge/index.ts`
- Read `provider` from Twilio `customParameters` in `start` event (not only query param).
- Send an immediate deterministic greeting (TTS directly) right after agent load, without waiting for chat completion.
- Rework chat timeout/fallback strategy:
  - Lower per-attempt timeout for voice turns.
  - Fewer retries for realtime calls.
  - If selected model is too slow, fallback to a fast Sarvam realtime model for that turn.
- Process utterances through a strict single worker queue so each transcript gets a timely reply and queued turns don’t wait behind long/failed generations.

4) Improve observability for fast diagnosis
- Add structured logs in bridge:
  - `turn_id`, transcript text, selected model, fallback-used, generation latency, tts-send latency.
  - “greeting_sent_ms” from stream start.
- This will let us verify “STT -> chat -> TTS” timing from logs in one glance.

5) Edge function config hardening
- File: `supabase/config.toml`
- Ensure entries exist:
  - `[functions.sarvam-voice-bridge] verify_jwt = false`
  - `[functions.handle-twilio-status] verify_jwt = false`
- This keeps telephony-originated webhook/WS flows consistently reachable and debuggable.

6) Validation plan (after implementation)
- Twilio outbound test (Sarvam agent):
  - Expected: no “application error”, WS 101 to `sarvam-voice-bridge`, greeting audible within a few seconds.
- Telnyx outbound test:
  - Expected: STT transcript logs appear, chat response generated without long timeout chain, TTS sent before call end.
- Log checks:
  - Confirm sequence per turn: `STT transcript` -> `chat response` -> `TTS audio sent`.
  - Confirm no repeated `Chat timeout` loop delaying first response.
- Data checks:
  - `call_logs` status transitions out of `initiated` for Twilio and reflect terminal state correctly.

Technical details
```text
Twilio outbound (fixed)
make-outbound-call
  -> Twilio Calls API (Twiml with Stream url clean + Parameters: agent_id, provider=twilio)
  -> sarvam-voice-bridge WS upgrade (101)
  -> STT (REST) -> Chat (fast/fallback) -> TTS -> Twilio media packets

Telnyx outbound (fixed latency)
make-outbound-call -> handle-telnyx-webhook streaming_start
  -> sarvam-voice-bridge WS (provider=telnyx)
  -> VAD+STT transcript quickly
  -> queued turn worker + fast chat fallback
  -> TTS audio sent before caller hangup
```

No database migration is required for this fix.
