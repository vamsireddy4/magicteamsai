// Gemini Live API ↔ Twilio/Telnyx WebSocket bridge
// Zero npm imports to avoid edge function shutdown issues

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

// Helper to parse WebSocket messages (Gemini may send Blob or string)
async function parseWsMessage(data: unknown): Promise<Record<string, unknown>> {
  let text: string;
  if (data instanceof Blob) {
    text = await data.text();
  } else {
    text = data as string;
  }
  return JSON.parse(text);
}

// Default model for Gemini Live API
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

Deno.serve((req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id");
  if (!agentId) {
    return new Response("agent_id required", { status: 400 });
  }

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    return new Response("GEMINI_API_KEY not configured", { status: 500 });
  }

  // Upgrade WebSocket IMMEDIATELY
  const { socket, response } = Deno.upgradeWebSocket(req);

  let geminiWs: WebSocket | null = null;
  let streamSid = "";
  let geminiReady = false;
  const audioBuffer: string[] = [];

  let prompt = "You are a helpful AI assistant.";
  let model = DEFAULT_GEMINI_MODEL;
  let voice = "Puck";
  let agentLoaded = false;

  async function loadAgent() {
    try {
      const sbUrl = Deno.env.get("SUPABASE_URL")!;
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

      const agentRes = await fetch(
        `${sbUrl}/rest/v1/agents?id=eq.${agentId}&select=system_prompt,model,voice`,
        { headers }
      );
      const agents = await agentRes.json();
      if (agents?.length > 0) {
        prompt = agents[0].system_prompt || prompt;
        // Map deprecated model names to working ones
        const rawModel = agents[0].model || "";
        if (rawModel.includes("gemini-2.0-flash")) {
          model = DEFAULT_GEMINI_MODEL; // deprecated models → use default
        } else if (rawModel.includes("gemini")) {
          model = rawModel;
        }
        voice = agents[0].voice || voice;
      }

      const kbRes = await fetch(
        `${sbUrl}/rest/v1/knowledge_base_items?agent_id=eq.${agentId}&select=title,content,website_url`,
        { headers }
      );
      const kbItems = await kbRes.json();
      if (kbItems?.length > 0) {
        prompt += "\n\n--- KNOWLEDGE BASE ---\n";
        for (const item of kbItems) {
          if (item.content) prompt += `\n## ${item.title}\n${item.content}\n`;
          if (item.website_url) prompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
        }
      }

      agentLoaded = true;
      console.log("Agent loaded: model=" + model + " voice=" + voice);
    } catch (e) {
      console.error("Agent load error:", e);
      agentLoaded = true; // proceed with defaults
    }
  }

  function connectGemini() {
    if (!agentLoaded) {
      setTimeout(connectGemini, 100);
      return;
    }

    console.log("Connecting to Gemini: model=" + model);
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
    geminiWs = new WebSocket(geminiUrl);

    geminiWs.onopen = () => {
      console.log("Gemini WS connected, sending setup...");
      geminiWs!.send(JSON.stringify({
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
      }));
    };

    geminiWs.onmessage = async (ev) => {
      try {
        const msg = await parseWsMessage(ev.data);

        if (msg.setupComplete) {
          console.log("Gemini setup complete - ready for audio");
          geminiReady = true;
          const count = audioBuffer.length;
          for (const chunk of audioBuffer) {
            geminiWs!.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: chunk }] },
            }));
          }
          audioBuffer.length = 0;
          if (count > 0) console.log("Flushed " + count + " buffered chunks");
          return;
        }

        // Handle audio response
        const parts = (msg.serverContent as any)?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data && part.inlineData.mimeType?.includes("audio/pcm")) {
              const pcm = b64decode(part.inlineData.data);
              const mulaw = pcm24kToMulaw8k(pcm);
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                  event: "media",
                  streamSid,
                  media: { payload: b64encode(mulaw) },
                }));
              }
            }
          }
        }

        if (msg.error) {
          console.error("Gemini error:", JSON.stringify(msg.error));
        }
      } catch (e) {
        console.error("Gemini msg parse error:", e);
      }
    };

    geminiWs.onerror = (e) => console.error("Gemini WS error:", e);

    geminiWs.onclose = (ev) => {
      console.log("Gemini closed: code=" + ev.code + " reason=" + ev.reason);
      geminiReady = false;
      setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(); }, 500);
    };
  }

  socket.onopen = () => {
    console.log("Telephony WS connected");
    loadAgent();
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.start?.stream_id || "";
        console.log("Stream started: " + streamSid);
        connectGemini();
      } else if (msg.event === "media") {
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
        }
      } else if (msg.event === "stop") {
        console.log("Stream stopped");
        if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
      }
    } catch (e) {
      console.error("Telephony msg error:", e);
    }
  };

  socket.onclose = () => {
    console.log("Telephony WS closed");
    geminiReady = false;
    if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
  };

  socket.onerror = (e) => console.error("Telephony WS error:", e);

  return response;
});
