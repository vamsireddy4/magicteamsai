// Sarvam AI ↔ Twilio/Telnyx WebSocket bridge
// Uses REST STT (reliable auth) → Chat Completions → TTS (mulaw) pipeline

const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

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
  view.setUint32(16, 16, true);       // chunk size
  view.setUint16(20, 1, true);        // PCM format
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, 8000, true);     // sample rate
  view.setUint32(28, 16000, true);    // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
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
    let ttsInFlight = false;
    let pendingQueue: string[] = []; // queued transcripts while TTS in flight

    // Provider detection: prefer query param, fallback to event-based
    let telephonyProvider: "twilio" | "telnyx" = (queryProvider === "telnyx" ? "telnyx" : "twilio");

    // ── VAD + Audio Buffering for REST STT ──
    const SPEECH_THRESHOLD = 250;    // RMS energy threshold
    const SILENCE_DURATION_MS = 800; // ms of silence to end utterance
    const MIN_SPEECH_MS = 400;       // minimum speech to process
    const MAX_BUFFER_MS = 15000;     // force-send after 15s
    const SAMPLE_RATE = 8000;
    const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 16 bytes/ms for 8kHz 16-bit

    let audioBuffer: Uint8Array[] = [];
    let audioBufferBytes = 0;
    let isSpeaking = false;
    let silenceStartMs = 0;
    let speechStartMs = 0;
    let vadTimer: number | null = null;
    let greetingSent = false;

    function cleanup(reason: string) {
      if (closed) return;
      closed = true;
      console.log(`[SARVAM-BRIDGE] Cleanup: ${reason}`);
      if (vadTimer) clearInterval(vadTimer);
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

    // ── REST STT: send buffered audio to Sarvam REST endpoint ──
    async function transcribeAudio(pcm16Data: Uint8Array): Promise<string> {
      if (pcm16Data.length < 1600) return ""; // less than 100ms, skip

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

    // ── Chat Completion with retry on 5xx ──
    async function chatCompletion(userText: string): Promise<string> {
      if (!agentConfig) return "I'm sorry, I'm having trouble processing that.";

      conversationHistory.push({ role: "user", content: userText });
      if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-16);
      }

      const messages = [
        { role: "system", content: agentConfig.prompt + "\n\nIMPORTANT: Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown, lists, or formatting." },
        ...conversationHistory,
      ];

      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

          const res = await fetch(SARVAM_CHAT_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-subscription-key": sarvamApiKey!,
            },
            body: JSON.stringify({
              model: agentConfig.model,
              messages,
              max_tokens: 300,
              temperature: 0.7,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (res.status >= 500 && attempt < maxRetries) {
            const errText = await res.text();
            console.warn(`[SARVAM-BRIDGE] Chat API ${res.status} (attempt ${attempt + 1}/${maxRetries + 1}): ${errText.substring(0, 200)}`);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff
            continue;
          }

          if (!res.ok) {
            const errText = await res.text();
            console.error(`[SARVAM-BRIDGE] Chat API error: ${res.status} ${errText.substring(0, 200)}`);
            return "I'm sorry, I'm experiencing technical difficulties. Could you please repeat that?";
          }

          const data = await res.json();
          const assistantMsg = data.choices?.[0]?.message?.content || "I didn't catch that, could you repeat?";
          conversationHistory.push({ role: "assistant", content: assistantMsg });
          return assistantMsg;
        } catch (e: any) {
          if (e.name === "AbortError" && attempt < maxRetries) {
            console.warn(`[SARVAM-BRIDGE] Chat timeout (attempt ${attempt + 1})`);
            continue;
          }
          console.error("[SARVAM-BRIDGE] Chat error:", e);
          return "I'm sorry, something went wrong. Please try again.";
        }
      }
      return "I'm sorry, I'm experiencing delays. Could you please repeat that?";
    }

    // ── Send mulaw audio back to telephony ──
    function sendAudioToTelephony(mulawBytes: Uint8Array) {
      const CHUNK_SIZE = 640; // 80ms at 8kHz mulaw
      for (let i = 0; i < mulawBytes.length; i += CHUNK_SIZE) {
        const chunk = mulawBytes.slice(i, i + CHUNK_SIZE);
        if (socket.readyState !== WebSocket.OPEN || closed) break;

        if (telephonyProvider === "telnyx") {
          socket.send(chunk);
        } else {
          socket.send(JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: b64encode(chunk) },
          }));
        }
      }
    }

    // ── TTS: convert text to mulaw audio via Sarvam TTS ──
    async function speakViaSarvamTTS(text: string) {
      if (!text.trim() || !agentConfig) return;
      console.log(`[SARVAM-BRIDGE] TTS: voice=${agentConfig.voice} text="${text.substring(0, 80)}..."`);

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
        sendAudioToTelephony(audioBytes);
        console.log(`[SARVAM-BRIDGE] TTS audio sent (${audioBytes.length} bytes, provider=${telephonyProvider})`);
      } catch (e) {
        console.error("[SARVAM-BRIDGE] TTS error:", e);
      }
    }

    // ── Process a complete utterance: STT → Chat → TTS ──
    async function processUtterance(pcm16Data: Uint8Array) {
      const transcript = await transcribeAudio(pcm16Data);
      if (!transcript) return;

      if (ttsInFlight) {
        console.log(`[SARVAM-BRIDGE] TTS in flight, queuing: "${transcript}"`);
        pendingQueue.push(transcript);
        return;
      }

      ttsInFlight = true;
      try {
        const response = await chatCompletion(transcript);
        console.log(`[SARVAM-BRIDGE] Chat response: "${response.substring(0, 80)}..."`);
        await speakViaSarvamTTS(response);
      } finally {
        ttsInFlight = false;
        // Process queued transcripts
        if (pendingQueue.length > 0) {
          const queued = pendingQueue.join(" ");
          pendingQueue = [];
          await processUtterance(new Uint8Array(0)); // won't do anything since empty
          // Actually process the queued text directly
          ttsInFlight = true;
          try {
            const response = await chatCompletion(queued);
            await speakViaSarvamTTS(response);
          } finally {
            ttsInFlight = false;
          }
        }
      }
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
        // Still accumulate during silence gap
        audioBuffer.push(pcm16);
        audioBufferBytes += pcm16.length;

        if (silenceStartMs === 0) {
          silenceStartMs = now;
        }

        const silenceDuration = now - silenceStartMs;
        const speechDuration = now - speechStartMs;

        if (silenceDuration >= SILENCE_DURATION_MS && speechDuration >= MIN_SPEECH_MS) {
          // End of utterance
          isSpeaking = false;
          console.log(`[SARVAM-BRIDGE] VAD: speech end (${speechDuration}ms speech, ${audioBufferBytes} bytes)`);

          // Merge buffer and process
          const merged = new Uint8Array(audioBufferBytes);
          let offset = 0;
          for (const chunk of audioBuffer) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          audioBuffer = [];
          audioBufferBytes = 0;
          silenceStartMs = 0;

          // Process async - don't block audio pipeline
          processUtterance(merged);
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
        processUtterance(merged);
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
          // Extract stream identifier from all known shapes
          streamSid = msg.start?.streamSid || msg.start?.stream_id || msg.streamSid || msg.stream_id || "";

          const customParams = msg.start?.customParameters || {};
          if (customParams.agent_id && !agentId) {
            agentId = customParams.agent_id;
          }

          // Detect Telnyx from start event shape
          if (!queryProvider && msg.start?.stream_id && !msg.start?.streamSid) {
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

            // Send initial greeting after short delay
            if (!greetingSent) {
              greetingSent = true;
              setTimeout(async () => {
                if (!closed && agentConfig) {
                  try {
                    const greeting = await chatCompletion("The call has just started. Please greet the caller.");
                    console.log(`[SARVAM-BRIDGE] Greeting: "${greeting.substring(0, 80)}..."`);
                    await speakViaSarvamTTS(greeting);
                  } catch (e) {
                    console.error("[SARVAM-BRIDGE] Greeting error:", e);
                    // Fallback greeting
                    await speakViaSarvamTTS("Hello! How can I help you today?");
                  }
                }
              }, 500);
            }
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
