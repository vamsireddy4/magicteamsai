
Goal: fix Sarvam call quality so Telnyx is audible, Twilio reliably captures caller speech, and turn latency drops significantly.

What I confirmed from your latest logs/code:
1) Telnyx call flow reaches the Sarvam bridge, STT and chat run, and TTS is generated — but playback is still effectively broken for callers.
2) In `sarvam-voice-bridge`, Telnyx outbound audio is currently sent as binary RTP packets. Telnyx bidirectional websocket expects `event:"media"` JSON with base64 payload, so this transport mismatch is the most likely cause of “no answer” on Telnyx.
3) Twilio does receive caller speech (multiple STT transcripts exist), but VAD/barge-in is too aggressive, causing many short/empty turns and “I didn’t catch that” loops.
4) Latency is high due to long model replies + full TTS playback blocking turn completion.

Implementation plan:
1) Fix Telnyx outbound media transport in `supabase/functions/sarvam-voice-bridge/index.ts`
   - Remove Telnyx binary RTP send path.
   - Send Telnyx audio using websocket JSON media events (`event: "media"`, base64 payload), same stable pattern used in the Gemini bridge.
   - Keep inbound parser tolerant (raw payload vs RTP-header payload) so STT remains robust.
   - Add explicit Telnyx frame-send counters/logs for first packet and ongoing packet counts.

2) Improve Twilio speech capture reliability in `sarvam-voice-bridge`
   - Add anti-echo barge-in gating while bot audio is playing (require sustained speech window + higher RMS before interrupt).
   - Raise minimum valid utterance duration and ignore very short/low-confidence transcript segments.
   - Add duplicate/empty-turn suppression to stop repeated fallback loops.

3) Reduce latency aggressively in `sarvam-voice-bridge`
   - Use fast Sarvam model first for voice turns; fallback to larger model only when needed.
   - Reduce generation budget (`max_tokens`) and enforce short spoken responses (single short sentence cap).
   - Separate playback from turn processing so STT/chat are not blocked by long TTS playback; keep interruption token logic to cancel stale audio quickly.
   - Make greeting ultra-short and cache-first to minimize dead air.

4) Prevent provider confusion at call time in UI
   - Update `src/pages/OutboundCall.tsx` to show selected agent provider/model clearly before placing a call.
   - If agent is not Sarvam when user expects Sarvam, show a clear warning before submit.

5) Validation after changes
   - Twilio test: confirm caller speech creates clean transcripts and relevant replies (no rapid empty-turn loop).
   - Telnyx test: confirm greeting and response are audible; logs show outbound media frames sent via JSON path.
   - Latency checks: track `speech_end -> STT -> chat -> TTS send start` timing and verify substantial reduction.

Technical details (key code-level targets):
- `sarvam-voice-bridge/index.ts`
  - Replace Telnyx branch in `sendAudioToTelephony`.
  - Tune VAD constants + barge-in conditions.
  - Add transcript filtering + turn dedupe guard.
  - Rework queue so audio send does not serialize all subsequent turns.
  - Keep detailed per-turn metrics (`turn_id`, `stt_ms`, `chat_ms`, `tts_ms`, `provider`).
- `src/pages/OutboundCall.tsx`
  - Surface agent AI provider/model near selection and submit button.
  - Add lightweight warning state for mismatched provider expectation.

Scope note:
- No database migration required for this fix set.
