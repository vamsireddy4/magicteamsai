
Goal: fix why Sarvam calls connect but the agent never replies.

What I found from current code + logs:
- `sarvam-voice-bridge` repeatedly logs `STT WS error` and `STT WS closed: code=0` without ever logging “STT WS connected”.
- Current STT connection uses `input_audio_codec=mulaw`, but Sarvam streaming STT expects audio sent as JSON payloads (`audio`, `encoding`, `sample_rate`) and supported raw codecs are PCM/WAV, not mulaw.
- Current bridge sends raw binary chunks directly to STT (`sttWs.send(audioData)`), which does not match Sarvam’s expected streaming message format.
- For Telnyx, stream IDs are often not captured (`sid=` blank), and the bridge currently assumes Twilio-like media handling only.
- `AgentForm` still defaults Sarvam voice to `meera` in two places, which is now outside the validated voice list and can reintroduce TTS failures for new agents.

Implementation plan:

1) Rework Sarvam STT handshake + payload protocol in `supabase/functions/sarvam-voice-bridge/index.ts`
- Connect with Sarvam auth header (`Api-Subscription-Key`) using WebSocket options (and keep safe fallback path).
- Remove unsupported `input_audio_codec=mulaw`.
- Keep connection params aligned with telephony input (`model=saaras:v3`, `mode=transcribe`, `sample_rate=8000`, `vad_signals=true`, optional `flush_signal=true`).
- Send STT audio as JSON messages:
  - `audio`: base64
  - `encoding`: `pcm_s16le`
  - `sample_rate`: `8000`
- Stop sending raw binary frames directly.

2) Add audio normalization before STT
- Reuse codec helpers pattern from Gemini bridge:
  - decode incoming mulaw to PCM16 (8kHz) for STT.
- For Telnyx calls, handle RTP packet input explicitly (extract PCMU payload before decode) instead of treating full packet bytes as raw audio.

3) Fix STT response parsing + turn execution
- Parse Sarvam response envelopes (`type`, `data`) and only trigger chat/TTS on final transcript events.
- Ignore non-transcript events (`speech_start`, `speech_end`) except for state tracking.
- Add an in-flight guard/queue so overlapping transcripts don’t trigger stacked TTS responses.

4) Ensure output audio is provider-correct
- Twilio: keep current `media + streamSid` send format.
- Telnyx: send audio in the format expected for its bidirectional RTP streaming path (not Twilio-only assumptions), and capture `stream_id`/identifier reliably from start events.
- Add structured logs that print provider detection, stream identifiers, and first inbound media metadata.

5) Prevent regression from UI defaults
- In `src/pages/AgentForm.tsx`, change Sarvam default voice to a valid speaker (e.g. `anushka`) in both:
  - provider-switch defaults
  - “custom voice off” reset path

6) Config hardening
- Add missing function config in `supabase/config.toml`:
  - `[functions.sarvam-voice-bridge]`
  - `verify_jwt = false`
- This avoids future deployment regressions for telephony-originated websocket calls.

Validation plan (after implementation):
- Make one Twilio and one Telnyx outbound Sarvam call.
- Confirm logs show `STT WS connected` (no reconnect loop), transcript events received, chat response generated, and TTS audio sent.
- Verify audible behavior end-to-end: greeting + reply after user speaks.
- Confirm call status in backend logs updates normally without STT/TTS errors.
