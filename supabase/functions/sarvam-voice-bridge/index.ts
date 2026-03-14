// Sarvam AI ↔ Twilio/Telnyx WebSocket bridge
// Uses REST STT (reliable auth) → Chat Completions → TTS (mulaw) pipeline

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

// Fast model for realtime fallback when primary model is too slow
const FAST_CHAT_MODEL = "sarvam-m";

const LANGUAGE_MAP: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN",
  kn: "kn-IN", ml: "ml-IN", bn: "bn-IN", gu: "gu-IN",
  mr: "mr-IN", pa: "pa-IN", or: "od-IN", ur: "ur-IN",
  "en-IN": "en-IN", "hi-IN": "hi-IN", "ta-IN": "ta-IN",
  "te-IN": "te-IN", "kn-IN": "kn-IN", "ml-IN": "ml-IN",
  "bn-IN": "bn-IN", "gu-IN": "gu-IN", "mr-IN": "mr-IN",
  "pa-IN": "pa-IN", "od-IN": "od-IN", "ur-IN": "ur-IN",
  unknown: "unknown",
};

// ── μ-law decode table ──
const MULAW_DECODE_TABLE = new Int16Array(256);
(function () {
  for (let i = 0; i < 256; i++) {
    let val = ~i & 0xff;
    const sign = val & 0x80;
    const exp = (val >> 4) & 0x07;
    const man = val & 0x0f;
    let mag = ((man << 1) + 33) << (exp + 2);
    mag -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -mag : mag;
  }
})();

function mulawToPcm16(mu: Uint8Array): Uint8Array {
  const buf = new ArrayBuffer(mu.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < mu.length; i++) {
    view.setInt16(i * 2, MULAW_DECODE_TABLE[mu[i]], true);
  }
  return new Uint8Array(buf);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ── PCM16 → μ-law encoder ──
function pcm16SampleToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  let mask = 0x4000;
  for (; exponent > 0; exponent--, mask >>= 1) {
    if (sample & mask) break;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function pcm16BufferToMulaw(pcm16: Uint8Array): Uint8Array {
  const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const samples = pcm16.length / 2;
  const mulaw = new Uint8Array(samples);
  for (let i = 0; i < samples; i++) {
    mulaw[i] = pcm16SampleToMulaw(view.getInt16(i * 2, true));
  }
  return mulaw;
}

// Simple linear-interpolation resampler for PCM16 mono
function resamplePcm16(pcm16: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate) return pcm16;
  const inView = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const inputSamples = pcm16.length / 2;
  const outputSamples = Math.floor(inputSamples * toRate / fromRate);
  const output = new Uint8Array(outputSamples * 2);
  const outView = new DataView(output.buffer);
  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * fromRate / toRate;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;
    const s0 = srcIdx < inputSamples ? inView.getInt16(srcIdx * 2, true) : 0;
    const s1 = srcIdx + 1 < inputSamples ? inView.getInt16((srcIdx + 1) * 2, true) : s0;
    outView.setInt16(i * 2, Math.round(s0 + frac * (s1 - s0)), true);
  }
  return output;
}

// Parse TTS audio response: detect WAV container, extract + convert to 8kHz mulaw
function parseTTSAudioToMulaw(audioBytes: Uint8Array): Uint8Array {
  // Check for RIFF/WAV header
  if (audioBytes.length > 44 &&
      audioBytes[0] === 0x52 && audioBytes[1] === 0x49 &&
      audioBytes[2] === 0x46 && audioBytes[3] === 0x46) {
    const view = new DataView(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength);
    const audioFormat = view.getUint16(20, true); // 1=PCM, 6=alaw, 7=mulaw
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    console.log(`[SARVAM-BRIDGE] WAV detected: fmt=${audioFormat} rate=${sampleRate} bits=${bitsPerSample} size=${audioBytes.length}`);

    // Find "data" chunk
    let offset = 12;
    while (offset < audioBytes.length - 8) {
      const chunkId = String.fromCharCode(audioBytes[offset], audioBytes[offset+1], audioBytes[offset+2], audioBytes[offset+3]);
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === "data") {
        const rawData = audioBytes.slice(offset + 8, offset + 8 + chunkSize);
        
        if (audioFormat === 7) {
          // Already mulaw — check sample rate
          if (sampleRate === 8000) return rawData;
          // Rare: mulaw at non-8kHz — decode to PCM16, resample, re-encode
          const pcm16 = mulawToPcm16(rawData);
          const resampled = resamplePcm16(pcm16, sampleRate, 8000);
          return pcm16BufferToMulaw(resampled);
        }
        
        if (audioFormat === 1 && bitsPerSample === 16) {
          // PCM16 — resample to 8kHz then encode to mulaw
          const resampled = resamplePcm16(rawData, sampleRate, 8000);
          return pcm16BufferToMulaw(resampled);
        }
        
        console.warn(`[SARVAM-BRIDGE] Unknown WAV format=${audioFormat} bits=${bitsPerSample}, sending raw`);
        return rawData;
      }
      offset += 8 + chunkSize;
      if (chunkSize % 2 !== 0) offset++; // WAV chunks are 2-byte aligned
    }
    console.warn("[SARVAM-BRIDGE] WAV: no data chunk found, sending raw");
  }

  // Not a WAV — assume raw mulaw
  console.log(`[SARVAM-BRIDGE] Non-WAV audio: ${audioBytes.length} bytes, assuming raw mulaw`);
  return audioBytes;
}

// Build WAV file from PCM16 mono 8kHz data
function buildWav(pcm16: Uint8Array): Uint8Array {
  const dataSize = pcm16.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const wav = new Uint8Array(44 + dataSize);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm16, 44);
  return wav;
}

// Compute RMS energy of PCM16 LE buffer
function computeRms(pcm16: Uint8Array): number {
  const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const samples = pcm16.length / 2;
  if (samples === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}

let turnCounter = 0;

interface AgentConfig {
  prompt: string;
  model: string;
  voice: string;
  languageHint: string;
  userId: string;
  agentTools: any[];
  calendarIntegrations: any[];
}

Deno.serve((req) => {
  console.log("[SARVAM-BRIDGE] === Handler invoked ===");
  try {
    const reqUrl = new URL(req.url);
    const upgradeHeader = req.headers.get("upgrade") || "";

    if (upgradeHeader.toLowerCase() !== "websocket") {
      return new Response(JSON.stringify({ status: "ok", service: "sarvam-voice-bridge" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    let agentId = reqUrl.searchParams.get("agent_id") || "";
    const queryProvider = reqUrl.searchParams.get("provider") || "";
    console.log(`[SARVAM-BRIDGE] agent_id="${agentId}" query_provider="${queryProvider}"`);

    const sarvamApiKey = Deno.env.get("SARVAM_API_KEY");
    if (!sarvamApiKey) return new Response("SARVAM_API_KEY not configured", { status: 500 });

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { socket, response } = Deno.upgradeWebSocket(req);

    let streamSid = "";
    let closed = false;
    let agentConfig: AgentConfig | null = null;
    let conversationHistory: { role: string; content: string }[] = [];
    let greetingSent = false;
    const streamStartMs = Date.now();

    // Provider detection: prefer query param, fallback to event-based
    let telephonyProvider: "twilio" | "telnyx" = (queryProvider === "telnyx" ? "telnyx" : "twilio");

    // ── Outbound audio state (pacing + RTP packetization for Telnyx) ──
    let twilioSendChain: Promise<void> = Promise.resolve();
    let telnyxSendChain: Promise<void> = Promise.resolve();
    let rtpSeq = 0;
    let rtpTimestamp = 0;
    let rtpSsrc = Math.floor(Math.random() * 0xffffffff);

    // ── VAD + Audio Buffering for REST STT ──
    const SPEECH_THRESHOLD = 250;
    const SILENCE_DURATION_MS = 800;
    const MIN_SPEECH_MS = 400;
    const MAX_BUFFER_MS = 15000;
    const SAMPLE_RATE = 8000;
    const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;

    let audioBuffer: Uint8Array[] = [];
    let audioBufferBytes = 0;
    let isSpeaking = false;
    let silenceStartMs = 0;
    let speechStartMs = 0;

    // ── Turn queue: process one turn at a time ──
    let turnProcessing = false;
    const turnQueue: Uint8Array[] = [];

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    function createRtpPacket(payload: Uint8Array): Uint8Array {
      const packet = new Uint8Array(12 + payload.length);
      packet[0] = 0x80; // RTP version 2
      packet[1] = 0x00; // PT=0 (PCMU)
      packet[2] = (rtpSeq >> 8) & 0xff;
      packet[3] = rtpSeq & 0xff;
      packet[4] = (rtpTimestamp >> 24) & 0xff;
      packet[5] = (rtpTimestamp >> 16) & 0xff;
      packet[6] = (rtpTimestamp >> 8) & 0xff;
      packet[7] = rtpTimestamp & 0xff;
      packet[8] = (rtpSsrc >> 24) & 0xff;
      packet[9] = (rtpSsrc >> 16) & 0xff;
      packet[10] = (rtpSsrc >> 8) & 0xff;
      packet[11] = rtpSsrc & 0xff;
      packet.set(payload, 12);

      rtpSeq = (rtpSeq + 1) & 0xffff;
      rtpTimestamp = (rtpTimestamp + payload.length) >>> 0; // 8kHz PCMU: 1 byte = 1 sample
      return packet;
    }

    function cleanup(reason: string) {
      if (closed) return;
      closed = true;
      console.log(`[SARVAM-BRIDGE] Cleanup: ${reason}`);
      try { if (socket.readyState === WebSocket.OPEN) socket.close(); } catch (_) { }
    }

    async function loadAgent(): Promise<AgentConfig> {
      let prompt = "You are a helpful AI assistant on a phone call. Be conversational and natural.";
      let model = "sarvam-m";
      let voice = "anushka";
      let languageHint = "en-IN";
      let userId = "";
      let agentTools: any[] = [];
      let calendarIntegrations: any[] = [];

      try {
        const headers: Record<string, string> = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
        const [agentRes, toolsRes, kbRes] = await Promise.all([
          fetch(`${sbUrl}/rest/v1/agents?id=eq.${agentId}&select=system_prompt,model,voice,user_id,language_hint`, { headers }),
          fetch(`${sbUrl}/rest/v1/agent_tools?agent_id=eq.${agentId}&is_active=eq.true&select=*`, { headers }),
          fetch(`${sbUrl}/rest/v1/knowledge_base_items?agent_id=eq.${agentId}&select=title,content,website_url`, { headers }),
        ]);

        if (agentRes.ok) {
          const agents = await agentRes.json();
          if (agents?.length > 0) {
            prompt = agents[0].system_prompt || prompt;
            model = agents[0].model || model;
            voice = agents[0].voice || voice;
            userId = agents[0].user_id || "";
            const hint = agents[0].language_hint || "en";
            languageHint = LANGUAGE_MAP[hint] || LANGUAGE_MAP[hint.split("-")[0]] || "en-IN";
            console.log(`[SARVAM-BRIDGE] Agent: model=${model} voice=${voice} lang=${languageHint}`);
          }
        }

        if (toolsRes.ok) {
          const tools = await toolsRes.json();
          if (tools?.length > 0) agentTools = tools;
        }

        if (kbRes.ok) {
          const kbItems = await kbRes.json();
          if (kbItems?.length > 0) {
            prompt += "\n\n--- KNOWLEDGE BASE ---\n";
            for (const item of kbItems) {
              if (item.content) prompt += `\n## ${item.title}\n${item.content}\n`;
              else if (item.website_url) prompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
            }
          }
        }

        if (userId) {
          const calRes = await fetch(
            `${sbUrl}/rest/v1/calendar_integrations?user_id=eq.${userId}&is_active=eq.true&select=id,provider,api_key,calendar_id,config`,
            { headers }
          );
          if (calRes.ok) {
            const cals = await calRes.json();
            if (cals?.length > 0) calendarIntegrations = cals;
          }
        }
      } catch (e) {
        console.error("[SARVAM-BRIDGE] Agent load error:", e);
      }

      return { prompt, model, voice, languageHint, userId, agentTools, calendarIntegrations };
    }

    // ── REST STT ──
    async function transcribeAudio(pcm16Data: Uint8Array): Promise<string> {
      if (pcm16Data.length < 1600) return "";

      const wavData = buildWav(pcm16Data);
      console.log(`[SARVAM-BRIDGE] REST STT: sending ${pcm16Data.length} bytes PCM16 (${(pcm16Data.length / BYTES_PER_MS).toFixed(0)}ms)`);

      try {
        const formData = new FormData();
        const wavBlob = new Blob([wavData], { type: "audio/wav" });
        formData.append("file", wavBlob, "audio.wav");
        formData.append("language_code", agentConfig?.languageHint || "en-IN");
        formData.append("model", "saaras:v3");

        const res = await fetch(SARVAM_STT_URL, {
          method: "POST",
          headers: { "Api-Subscription-Key": sarvamApiKey! },
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[SARVAM-BRIDGE] STT error: ${res.status} ${errText}`);
          return "";
        }

        const data = await res.json();
        const transcript = data.transcript || "";
        console.log(`[SARVAM-BRIDGE] STT transcript: "${transcript}"`);
        return transcript.trim();
      } catch (e) {
        console.error("[SARVAM-BRIDGE] STT fetch error:", e);
        return "";
      }
    }

    // ── Chat Completion with fast timeout + model fallback ──
    async function chatCompletion(userText: string): Promise<string> {
      if (!agentConfig) return "I'm sorry, I'm having trouble processing that.";

      const turnId = ++turnCounter;
      const chatStartMs = Date.now();

      conversationHistory.push({ role: "user", content: userText });
      if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-16);
      }

      const messages = [
        { role: "system", content: agentConfig.prompt + "\n\nIMPORTANT: Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown, lists, or formatting." },
        ...conversationHistory,
      ];

      // Try primary model first with short timeout, then fallback to fast model
      const attempts = [
        { model: agentConfig.model, timeout: 8000, label: "primary" },
        { model: FAST_CHAT_MODEL, timeout: 8000, label: "fallback" },
      ];
      // If primary IS already the fast model, just one attempt
      if (agentConfig.model === FAST_CHAT_MODEL) {
        attempts.splice(1); // remove fallback since same
      }

      for (const attempt of attempts) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), attempt.timeout);

          const res = await fetch(SARVAM_CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-subscription-key": sarvamApiKey!,
            },
            body: JSON.stringify({
              model: attempt.model,
              messages,
              max_tokens: 300,
              temperature: 0.7,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (res.status >= 500) {
            const errText = await res.text();
            console.warn(`[SARVAM-BRIDGE] turn=${turnId} Chat ${res.status} (${attempt.label}/${attempt.model}): ${errText.substring(0, 150)}`);
            continue; // try fallback
          }

          if (!res.ok) {
            const errText = await res.text();
            console.error(`[SARVAM-BRIDGE] turn=${turnId} Chat ${res.status}: ${errText.substring(0, 150)}`);
            continue;
          }

          const data = await res.json();
          const assistantMsg = data.choices?.[0]?.message?.content || "I didn't catch that, could you repeat?";
          conversationHistory.push({ role: "assistant", content: assistantMsg });
          const latency = Date.now() - chatStartMs;
          console.log(`[SARVAM-BRIDGE] turn=${turnId} chat_ok model=${attempt.model} latency=${latency}ms text="${assistantMsg.substring(0, 80)}"`);
          return assistantMsg;
        } catch (e: any) {
          const latency = Date.now() - chatStartMs;
          if (e.name === "AbortError") {
            console.warn(`[SARVAM-BRIDGE] turn=${turnId} chat_timeout model=${attempt.model} after=${latency}ms (${attempt.label})`);
            continue;
          }
          console.error(`[SARVAM-BRIDGE] turn=${turnId} chat_error (${attempt.label}):`, e);
          continue;
        }
      }

      // All attempts exhausted
      return "I'm sorry, I'm experiencing delays. Could you please repeat that?";
    }

    // ── Send mulaw audio back to telephony ──
    async function sendAudioToTelephony(mulawBytes: Uint8Array) {
      // 20ms frame @ 8kHz PCMU = 160 bytes
      const FRAME_SIZE = 160;
      const FRAME_DELAY_MS = 20;

      const sendFrames = async () => {
        for (let i = 0; i < mulawBytes.length; i += FRAME_SIZE) {
          const frame = mulawBytes.slice(i, i + FRAME_SIZE);
          if (socket.readyState !== WebSocket.OPEN || closed) break;

          if (telephonyProvider === "telnyx") {
            // Telnyx bidirectional RTP expects full RTP packets, not raw PCMU payload
            const rtpPacket = createRtpPacket(frame);
            socket.send(rtpPacket);
          } else {
            // Twilio media websocket expects JSON envelopes with base64 μ-law payload
            socket.send(JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: b64encode(frame) },
            }));
          }

          await sleep(FRAME_DELAY_MS);
        }
      };

      if (telephonyProvider === "telnyx") {
        telnyxSendChain = telnyxSendChain.then(sendFrames).catch((e) => {
          console.error("[SARVAM-BRIDGE] Telnyx send error:", e);
        });
        await telnyxSendChain;
      } else {
        twilioSendChain = twilioSendChain.then(sendFrames).catch((e) => {
          console.error("[SARVAM-BRIDGE] Twilio send error:", e);
        });
        await twilioSendChain;
      }
    }

    // ── TTS ──
    async function speakViaSarvamTTS(text: string) {
      if (!text.trim() || !agentConfig) return;
      const ttsStartMs = Date.now();
      console.log(`[SARVAM-BRIDGE] TTS: voice=${agentConfig.voice} text="${text.substring(0, 80)}"`);

      try {
        const res = await fetch(SARVAM_TTS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-subscription-key": sarvamApiKey!,
          },
          body: JSON.stringify({
            inputs: [text],
            target_language_code: agentConfig.languageHint || "en-IN",
            speaker: agentConfig.voice || "anushka",
            model: "bulbul:v2",
            audio_format: "mulaw",
            sample_rate: 8000,
          }),
        });

        if (!res.ok) {
          console.error(`[SARVAM-BRIDGE] TTS error: ${res.status} ${await res.text()}`);
          return;
        }

        const data = await res.json();
        const audioB64 = data.audios?.[0];
        if (!audioB64) {
          console.error("[SARVAM-BRIDGE] No audio in TTS response");
          return;
        }

        const audioBytes = b64decode(audioB64);
        await sendAudioToTelephony(audioBytes);
        const ttsLatency = Date.now() - ttsStartMs;
        console.log(`[SARVAM-BRIDGE] TTS sent ${audioBytes.length} bytes latency=${ttsLatency}ms provider=${telephonyProvider}`);
      } catch (e) {
        console.error("[SARVAM-BRIDGE] TTS error:", e);
      }
    }

    // ── Process turn queue one at a time ──
    async function drainTurnQueue() {
      if (turnProcessing) return;
      turnProcessing = true;

      while (turnQueue.length > 0) {
        if (closed) break;
        const pcm16Data = turnQueue.shift()!;

        const transcript = await transcribeAudio(pcm16Data);
        if (!transcript) continue;

        const response = await chatCompletion(transcript);
        await speakViaSarvamTTS(response);
      }

      turnProcessing = false;
    }

    // ── Enqueue utterance for processing ──
    function enqueueUtterance(pcm16Data: Uint8Array) {
      turnQueue.push(pcm16Data);
      drainTurnQueue();
    }

    // ── Send immediate greeting via TTS (no chat, deterministic) ──
    async function sendImmediateGreeting() {
      if (!agentConfig || greetingSent || closed) return;
      greetingSent = true;

      const greetingText = "Hello! How can I help you today?";
      console.log(`[SARVAM-BRIDGE] Sending immediate greeting (no chat)`);

      await speakViaSarvamTTS(greetingText);

      const elapsed = Date.now() - streamStartMs;
      console.log(`[SARVAM-BRIDGE] greeting_sent_ms=${elapsed} (from stream start)`);
    }

    // ── Feed PCM16 audio into VAD + buffer ──
    function feedAudio(pcm16: Uint8Array) {
      if (closed || !agentConfig) return;

      const rms = computeRms(pcm16);
      const now = Date.now();

      if (rms > SPEECH_THRESHOLD) {
        if (!isSpeaking) {
          isSpeaking = true;
          speechStartMs = now;
          audioBuffer = [];
          audioBufferBytes = 0;
          console.log(`[SARVAM-BRIDGE] VAD: speech start (rms=${rms.toFixed(0)})`);
        }
        silenceStartMs = 0;
        audioBuffer.push(pcm16);
        audioBufferBytes += pcm16.length;
      } else if (isSpeaking) {
        audioBuffer.push(pcm16);
        audioBufferBytes += pcm16.length;

        if (silenceStartMs === 0) {
          silenceStartMs = now;
        }

        const silenceDuration = now - silenceStartMs;
        const speechDuration = now - speechStartMs;

        if (silenceDuration >= SILENCE_DURATION_MS && speechDuration >= MIN_SPEECH_MS) {
          isSpeaking = false;
          console.log(`[SARVAM-BRIDGE] VAD: speech end (${speechDuration}ms speech, ${audioBufferBytes} bytes)`);

          const merged = new Uint8Array(audioBufferBytes);
          let offset = 0;
          for (const chunk of audioBuffer) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          audioBuffer = [];
          audioBufferBytes = 0;
          silenceStartMs = 0;

          enqueueUtterance(merged);
        }
      }

      // Force-send if buffer exceeds max duration
      if (isSpeaking && audioBufferBytes > MAX_BUFFER_MS * BYTES_PER_MS) {
        console.log(`[SARVAM-BRIDGE] VAD: force-send (max buffer ${MAX_BUFFER_MS}ms)`);
        isSpeaking = false;
        const merged = new Uint8Array(audioBufferBytes);
        let offset = 0;
        for (const chunk of audioBuffer) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        audioBuffer = [];
        audioBufferBytes = 0;
        silenceStartMs = 0;
        enqueueUtterance(merged);
      }
    }

    // ── Telephony WebSocket handlers ──
    socket.onopen = () => {
      console.log(`[SARVAM-BRIDGE] Telephony WS connected (initial provider=${telephonyProvider})`);
    };

    socket.onmessage = async (event) => {
      try {
        if (typeof event.data !== "string") {
          // Binary data — Telnyx bidirectional RTP stream
          if (telephonyProvider !== "telnyx") {
            telephonyProvider = "telnyx";
            console.log("[SARVAM-BRIDGE] Provider detected as telnyx (binary data)");
          }
          const rawBytes = new Uint8Array(
            event.data instanceof ArrayBuffer ? event.data : await (event.data as Blob).arrayBuffer()
          );
          // RTP: first 12 bytes are header, payload is PCMU
          const mulawPayload = rawBytes.length > 12 ? rawBytes.slice(12) : rawBytes;
          const pcm16 = mulawToPcm16(mulawPayload);
          feedAudio(pcm16);
          return;
        }

        const msg = JSON.parse(event.data);

        if (msg.event === "connected") {
          console.log("[SARVAM-BRIDGE] Twilio connected event");
          if (!queryProvider) telephonyProvider = "twilio";
        } else if (msg.event === "start") {
          streamSid = msg.start?.streamSid || msg.start?.stream_id || msg.streamSid || msg.stream_id || "";

          const customParams = msg.start?.customParameters || {};
          if (customParams.agent_id && !agentId) {
            agentId = customParams.agent_id;
          }
          // Read provider from Twilio customParameters (Parameter tags)
          if (customParams.provider) {
            telephonyProvider = customParams.provider === "telnyx" ? "telnyx" : "twilio";
            console.log(`[SARVAM-BRIDGE] Provider from customParameters: ${telephonyProvider}`);
          }

          // Detect Telnyx from start event shape
          if (!queryProvider && !customParams.provider && msg.start?.stream_id && !msg.start?.streamSid) {
            telephonyProvider = "telnyx";
          }

          console.log(`[SARVAM-BRIDGE] Stream started: sid=${streamSid} agent_id=${agentId} provider=${telephonyProvider}`);

          if (!agentId) {
            console.error("[SARVAM-BRIDGE] No agent_id!");
            cleanup("no_agent_id");
            return;
          }

          try {
            agentConfig = await loadAgent();
            console.log(`[SARVAM-BRIDGE] Agent loaded, REST STT mode ready`);

            // Send immediate deterministic greeting (no chat API call)
            sendImmediateGreeting();
          } catch (e) {
            console.error("[SARVAM-BRIDGE] Agent load failed:", e);
            cleanup("agent_load_failed");
          }
        } else if (msg.event === "media" && msg.media?.payload) {
          // Twilio: base64 mulaw audio in JSON
          const mulawData = b64decode(msg.media.payload);
          const pcm16 = mulawToPcm16(mulawData);
          feedAudio(pcm16);
        } else if (msg.event === "stop") {
          console.log("[SARVAM-BRIDGE] Stream stopped");
          cleanup("stream_stopped");
        }
      } catch (e) {
        console.error("[SARVAM-BRIDGE] Telephony message error:", e);
      }
    };

    socket.onclose = (ev) => {
      console.log(`[SARVAM-BRIDGE] Telephony WS closed: code=${ev.code}`);
      cleanup("telephony_closed");
    };

    socket.onerror = () => {
      console.error("[SARVAM-BRIDGE] Telephony WS error");
    };

    return response;
  } catch (e) {
    console.error("[SARVAM-BRIDGE] FATAL:", e);
    return new Response(JSON.stringify({ error: "Bridge crashed", details: String(e) }), { status: 500 });
  }
});
