// Gemini Live API ↔ Twilio/Telnyx WebSocket bridge
// Zero npm imports — pure Deno for edge function stability

const VALID_GEMINI_VOICES = new Set([
  "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Vale",
  "Zephyr", "Autonoe", "Umbriel", "Erinome", "Laomedeia", "Schedar",
  "Achird", "Sadachbia", "Sadaltager", "Callirrhoe", "Iapetus", "Despina",
]);

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-preview-native-audio-dialog";

// ── μ-law codec ──

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

function mulawEncode(s: number): number {
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > 32635) s = 32635;
  s += 0x84;
  let exp = 7, mask = 0x4000;
  for (; exp > 0; exp--, mask >>= 1) if ((s & mask) !== 0) break;
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}

// Convert 8kHz mulaw to 16kHz PCM16 (linear interpolation upsample 2x)
function mulawToPcm16k(mu: Uint8Array): Uint8Array {
  const buf = new ArrayBuffer(mu.length * 4);
  const v = new DataView(buf);
  for (let i = 0; i < mu.length; i++) {
    const s = MULAW_DECODE_TABLE[mu[i]];
    const n = i + 1 < mu.length ? MULAW_DECODE_TABLE[mu[i + 1]] : s;
    v.setInt16(i * 4, s, true);
    v.setInt16(i * 4 + 2, Math.round((s + n) / 2), true);
  }
  return new Uint8Array(buf);
}

// Convert 24kHz PCM16 to 8kHz mulaw (downsample 3x)
function pcm24kToMulaw8k(pcm: Uint8Array): Uint8Array {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const len = Math.floor(pcm.length / 6);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = mulawEncode(v.getInt16(i * 6, true));
  return out;
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

// ── Main server ──

Deno.serve((req) => {
  console.log("[BRIDGE] === Handler invoked ===");
  try {
    const reqUrl = new URL(req.url);
    const upgradeHeader = req.headers.get("upgrade") || "";
    console.log(`[BRIDGE] method=${req.method} upgrade="${upgradeHeader}" url=${reqUrl.pathname}${reqUrl.search}`);

    // Health check for non-WebSocket
    if (upgradeHeader.toLowerCase() !== "websocket") {
      return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), { 
        status: 200, headers: { "Content-Type": "application/json" } 
      });
    }

    console.log("[BRIDGE] WebSocket upgrade detected");
    const agentId = reqUrl.searchParams.get("agent_id");
    if (!agentId) return new Response("agent_id required", { status: 400 });

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) return new Response("GEMINI_API_KEY not configured", { status: 500 });

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log("[BRIDGE] Calling Deno.upgradeWebSocket...");
    const { socket, response } = Deno.upgradeWebSocket(req);
    console.log("[BRIDGE] WebSocket upgrade success");

  let geminiWs: WebSocket | null = null;
  let streamSid = "";
  let geminiReady = false;
  const audioBuffer: string[] = [];
  let keepaliveTimer: number | null = null;
  let closed = false;

  // ── Cleanup helper ──
  function cleanup(reason: string) {
    if (closed) return;
    closed = true;
    console.log(`[BRIDGE] Cleanup: ${reason}`);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    try { if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close(); } catch (_e) { /* ignore */ }
    try { if (socket.readyState === WebSocket.OPEN) socket.close(); } catch (_e) { /* ignore */ }
  }

  // ── Load agent config ──
  async function loadAgent(): Promise<{ prompt: string; model: string; voice: string }> {
    let prompt = "You are a helpful AI assistant on a phone call. Be conversational and natural.";
    let model = DEFAULT_GEMINI_MODEL;
    let voice = "Puck";

    try {
      const headers: Record<string, string> = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

      const agentRes = await fetch(
        `${sbUrl}/rest/v1/agents?id=eq.${agentId}&select=system_prompt,model,voice`,
        { headers }
      );
      if (!agentRes.ok) {
        console.error(`[BRIDGE] Agent fetch failed: ${agentRes.status} ${await agentRes.text()}`);
        return { prompt, model, voice };
      }
      const agents = await agentRes.json();
      if (agents?.length > 0) {
        prompt = agents[0].system_prompt || prompt;
        const rawModel = agents[0].model || "";
        if (rawModel.includes("gemini")) {
          model = rawModel;
        }
        const rawVoice = agents[0].voice || "Puck";
        voice = VALID_GEMINI_VOICES.has(rawVoice) ? rawVoice : "Puck";
        console.log(`[BRIDGE] Agent voice: requested="${rawVoice}" using="${voice}" model="${model}"`);
      }

      const kbRes = await fetch(
        `${sbUrl}/rest/v1/knowledge_base_items?agent_id=eq.${agentId}&select=title,content,website_url`,
        { headers }
      );
      if (kbRes.ok) {
        const kbItems = await kbRes.json();
        if (kbItems?.length > 0) {
          prompt += "\n\n--- KNOWLEDGE BASE ---\n";
          for (const item of kbItems) {
            if (item.content) prompt += `\n## ${item.title}\n${item.content}\n`;
            if (item.website_url) prompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
          }
        }
      }
    } catch (e) {
      console.error("[BRIDGE] Agent load error:", e);
    }

    return { prompt, model, voice };
  }

  // ── Connect to Gemini Live API ──
  function connectGemini(prompt: string, model: string, voice: string) {
    console.log(`[BRIDGE] Connecting to Gemini: model=models/${model} voice=${voice}`);

    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

    try {
      geminiWs = new WebSocket(geminiUrl);
    } catch (e) {
      console.error("[BRIDGE] Failed to create Gemini WebSocket:", e);
      cleanup("gemini_ws_create_failed");
      return;
    }

    geminiWs.onopen = () => {
      console.log("[BRIDGE] Gemini WS connected, sending setup...");
      try {
        const setupMsg = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            },
            systemInstruction: { parts: [{ text: prompt }] },
          },
        };
        geminiWs!.send(JSON.stringify(setupMsg));
        console.log("[BRIDGE] Gemini setup message sent");
      } catch (e) {
        console.error("[BRIDGE] Error sending Gemini setup:", e);
        cleanup("gemini_setup_send_error");
      }
    };

    geminiWs.onmessage = (ev) => {
      try {
        // Gemini sends text frames (JSON)
        const text = typeof ev.data === "string" ? ev.data : "";
        if (!text) {
          console.log("[BRIDGE] Gemini sent non-text message, skipping");
          return;
        }
        const msg = JSON.parse(text);

        if (msg.setupComplete) {
          console.log("[BRIDGE] Gemini setup complete — ready for audio");
          geminiReady = true;
          // Flush buffered audio
          const count = audioBuffer.length;
          for (const chunk of audioBuffer) {
            geminiWs!.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: chunk }] },
            }));
          }
          audioBuffer.length = 0;
          if (count > 0) console.log(`[BRIDGE] Flushed ${count} buffered audio chunks`);

          // Start keepalive — send empty audio periodically to keep connection alive
          keepaliveTimer = setInterval(() => {
            try {
              if (geminiWs?.readyState === WebSocket.OPEN && geminiReady) {
                // Send a tiny silent PCM frame (640 bytes = 20ms of 16kHz 16-bit)
                const silence = new Uint8Array(640);
                geminiWs.send(JSON.stringify({
                  realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64encode(silence) }] },
                }));
              }
            } catch (_e) { /* ignore keepalive errors */ }
          }, 15000) as unknown as number;
          return;
        }

        // Handle audio response from Gemini
        const parts = (msg.serverContent as any)?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data && part.inlineData.mimeType?.includes("audio/pcm")) {
              const pcm = b64decode(part.inlineData.data);
              const mulaw = pcm24kToMulaw8k(pcm);
              if (socket.readyState === WebSocket.OPEN && !closed) {
                socket.send(JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload: b64encode(mulaw) },
                }));
              }
            }
          }
        }

        // Handle turn complete
        if ((msg.serverContent as any)?.turnComplete) {
          // Model finished speaking — nothing to do, just log
          console.log("[BRIDGE] Gemini turn complete");
        }

        if (msg.error) {
          console.error("[BRIDGE] Gemini API error:", JSON.stringify(msg.error));
          cleanup("gemini_api_error");
        }
      } catch (e) {
        console.error("[BRIDGE] Gemini message parse error:", e);
      }
    };

    geminiWs.onerror = (e) => {
      console.error("[BRIDGE] Gemini WS error event fired");
      // Note: onerror doesn't provide useful info in Deno, onclose will follow
    };

    geminiWs.onclose = (ev) => {
      console.log(`[BRIDGE] Gemini WS closed: code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`);
      geminiReady = false;
      cleanup("gemini_closed");
    };
  }

  // ── Telephony WebSocket handlers ──

  socket.onopen = () => {
    console.log("[BRIDGE] Telephony WS connected — waiting for stream start");
  };

  socket.onmessage = async (event) => {
    try {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      const msg = JSON.parse(raw);

      if (msg.event === "connected") {
        console.log("[BRIDGE] Twilio connected event received");
      } else if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.start?.stream_id || msg.streamSid || "";
        console.log(`[BRIDGE] Stream started: sid=${streamSid}`);
        console.log(`[BRIDGE] Stream metadata: ${JSON.stringify(msg.start || {})}`);

        // Load agent THEN connect to Gemini — sequential to avoid race conditions
        try {
          const config = await loadAgent();
          console.log(`[BRIDGE] Agent loaded, connecting to Gemini...`);
          connectGemini(config.prompt, config.model, config.voice);
        } catch (e) {
          console.error("[BRIDGE] Failed to load agent:", e);
          cleanup("agent_load_failed");
        }
      } else if (msg.event === "media" && msg.media?.payload) {
        const mu = b64decode(msg.media.payload);
        const pcm = mulawToPcm16k(mu);
        const pcmB64 = b64encode(pcm);

        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          if (geminiReady) {
            geminiWs.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: pcmB64 }] },
            }));
          } else {
            audioBuffer.push(pcmB64);
            if (audioBuffer.length > 300) audioBuffer.shift();
          }
        } else if (!geminiWs) {
          // Buffer audio while Gemini is being set up
          audioBuffer.push(pcmB64);
          if (audioBuffer.length > 300) audioBuffer.shift();
        }
      } else if (msg.event === "stop") {
        console.log("[BRIDGE] Telephony stream stopped");
        cleanup("stream_stopped");
      } else if (msg.event === "mark") {
        // Twilio mark event — ignore
      } else {
        console.log(`[BRIDGE] Unknown telephony event: ${msg.event}`);
      }
    } catch (e) {
      console.error("[BRIDGE] Telephony message error:", e);
    }
  };

  socket.onclose = (ev) => {
    console.log(`[BRIDGE] Telephony WS closed: code=${ev.code} reason="${ev.reason}"`);
    cleanup("telephony_closed");
  };

  socket.onerror = (e) => {
    console.error("[BRIDGE] Telephony WS error event fired");
  };

  return response;
  } catch (e) {
    console.error("[BRIDGE] FATAL handler error:", e);
    return new Response(JSON.stringify({ error: "Bridge handler crashed", details: String(e) }), { status: 500 });
  }
});
