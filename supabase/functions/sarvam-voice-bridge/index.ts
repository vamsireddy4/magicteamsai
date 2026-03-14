// Sarvam AI ↔ Twilio/Telnyx WebSocket bridge
// STT (WebSocket) → Chat Completions → TTS (REST with mulaw) pipeline

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SARVAM_STT_WS_BASE = "wss://api.sarvam.ai/speech-to-text/ws";
const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

// Map language_hint to Sarvam language codes
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
    console.log(`[SARVAM-BRIDGE] agent_id from query: "${agentId}"`);

    const sarvamApiKey = Deno.env.get("SARVAM_API_KEY");
    if (!sarvamApiKey) return new Response("SARVAM_API_KEY not configured", { status: 500 });

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { socket, response } = Deno.upgradeWebSocket(req);

    let sttWs: WebSocket | null = null;
    let streamSid = "";
    let sttReady = false;
    let closed = false;
    let agentConfig: AgentConfig | null = null;
    const audioBuffer: Uint8Array[] = [];
    let conversationHistory: { role: string; content: string }[] = [];
    let keepaliveTimer: number | null = null;
    // Accumulate partial STT transcripts
    let pendingTranscript = "";

    function cleanup(reason: string) {
      if (closed) return;
      closed = true;
      console.log(`[SARVAM-BRIDGE] Cleanup: ${reason}`);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      try { if (sttWs?.readyState === WebSocket.OPEN) sttWs.close(); } catch (_) { }
      try { if (socket.readyState === WebSocket.OPEN) socket.close(); } catch (_) { }
    }

    async function loadAgent(): Promise<AgentConfig> {
      let prompt = "You are a helpful AI assistant on a phone call. Be conversational and natural.";
      let model = "sarvam-m";
      let voice = "meera";
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

    // Send text through Sarvam Chat Completions
    async function chatCompletion(userText: string): Promise<string> {
      if (!agentConfig) return "I'm sorry, I'm having trouble processing that.";

      conversationHistory.push({ role: "user", content: userText });

      // Keep conversation history manageable
      if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-16);
      }

      const messages = [
        { role: "system", content: agentConfig.prompt + "\n\nIMPORTANT: Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown, lists, or formatting." },
        ...conversationHistory,
      ];

      try {
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
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[SARVAM-BRIDGE] Chat API error: ${res.status} ${errText}`);
          return "I'm sorry, I'm experiencing technical difficulties. Could you please repeat that?";
        }

        const data = await res.json();
        const assistantMsg = data.choices?.[0]?.message?.content || "I didn't catch that, could you repeat?";
        conversationHistory.push({ role: "assistant", content: assistantMsg });
        return assistantMsg;
      } catch (e) {
        console.error("[SARVAM-BRIDGE] Chat error:", e);
        return "I'm sorry, something went wrong. Please try again.";
      }
    }

    // Convert text to speech using Sarvam TTS and send mulaw audio back to telephony
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
            speaker: agentConfig.voice || "meera",
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
        // Sarvam TTS returns base64-encoded audio in `audios` array
        const audioB64 = data.audios?.[0];
        if (!audioB64) {
          console.error("[SARVAM-BRIDGE] No audio in TTS response");
          return;
        }

        // Send audio in chunks to telephony
        const audioBytes = b64decode(audioB64);
        const CHUNK_SIZE = 640; // 80ms at 8kHz mulaw
        for (let i = 0; i < audioBytes.length; i += CHUNK_SIZE) {
          const chunk = audioBytes.slice(i, i + CHUNK_SIZE);
          if (socket.readyState === WebSocket.OPEN && !closed) {
            socket.send(JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: b64encode(chunk) },
            }));
          }
        }
        console.log(`[SARVAM-BRIDGE] TTS audio sent (${audioBytes.length} bytes)`);
      } catch (e) {
        console.error("[SARVAM-BRIDGE] TTS error:", e);
      }
    }

    // Connect to Sarvam STT WebSocket
    function connectSTT(config: AgentConfig) {
      const langCode = config.languageHint || "en-IN";
      const sttUrl = `${SARVAM_STT_WS_BASE}?language_code=${langCode}&api_subscription_key=${sarvamApiKey}`;

      console.log(`[SARVAM-BRIDGE] Connecting STT: lang=${langCode}`);

      try {
        sttWs = new WebSocket(sttUrl);
      } catch (e) {
        console.error("[SARVAM-BRIDGE] Failed to create STT WebSocket:", e);
        cleanup("stt_ws_create_failed");
        return;
      }

      sttWs.onopen = () => {
        console.log("[SARVAM-BRIDGE] STT WS connected");
        sttReady = true;

        // Send config message
        try {
          sttWs!.send(JSON.stringify({
            config: {
              sample_rate: 8000,
              encoding: "mulaw",
              language_code: langCode,
            },
          }));
        } catch (e) {
          console.error("[SARVAM-BRIDGE] STT config send error:", e);
        }

        // Flush buffered audio
        for (const chunk of audioBuffer) {
          if (sttWs?.readyState === WebSocket.OPEN) {
            sttWs.send(chunk);
          }
        }
        audioBuffer.length = 0;

        // Keepalive
        keepaliveTimer = setInterval(() => {
          try {
            if (sttWs?.readyState === WebSocket.OPEN) {
              sttWs.send(new Uint8Array(160)); // 20ms silence
            }
          } catch (_) { }
        }, 15000) as unknown as number;
      };

      sttWs.onmessage = async (ev) => {
        try {
          let text: string;
          if (typeof ev.data === "string") {
            text = ev.data;
          } else if (ev.data instanceof Blob) {
            text = await ev.data.text();
          } else {
            return;
          }

          const msg = JSON.parse(text);

          // Handle transcription results
          const transcript = msg.transcript || msg.text || "";
          const isFinal = msg.is_final || msg.type === "final" || msg.status === "success";

          if (transcript) {
            if (isFinal) {
              const fullText = (pendingTranscript + " " + transcript).trim();
              pendingTranscript = "";

              if (fullText) {
                console.log(`[SARVAM-BRIDGE] STT final: "${fullText}"`);
                // Process through chat and TTS
                const response = await chatCompletion(fullText);
                console.log(`[SARVAM-BRIDGE] Chat response: "${response.substring(0, 80)}..."`);
                await speakViaSarvamTTS(response);
              }
            } else {
              pendingTranscript += " " + transcript;
            }
          }
        } catch (e) {
          console.error("[SARVAM-BRIDGE] STT message error:", e);
        }
      };

      sttWs.onerror = () => {
        console.error("[SARVAM-BRIDGE] STT WS error");
      };

      sttWs.onclose = (ev) => {
        console.log(`[SARVAM-BRIDGE] STT WS closed: code=${ev.code}`);
        sttReady = false;
        // Attempt reconnect if not shutting down
        if (!closed) {
          console.log("[SARVAM-BRIDGE] Reconnecting STT...");
          setTimeout(() => {
            if (!closed && agentConfig) connectSTT(agentConfig);
          }, 1000);
        }
      };
    }

    // Telephony WebSocket handlers
    socket.onopen = () => {
      console.log("[SARVAM-BRIDGE] Telephony WS connected");
    };

    socket.onmessage = async (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        if (!raw) return;
        const msg = JSON.parse(raw);

        if (msg.event === "connected") {
          console.log("[SARVAM-BRIDGE] Twilio connected");
        } else if (msg.event === "start") {
          streamSid = msg.start?.streamSid || msg.start?.stream_id || msg.streamSid || "";

          const customParams = msg.start?.customParameters || {};
          if (customParams.agent_id && !agentId) {
            agentId = customParams.agent_id;
          }

          console.log(`[SARVAM-BRIDGE] Stream started: sid=${streamSid} agent_id=${agentId}`);

          if (!agentId) {
            console.error("[SARVAM-BRIDGE] No agent_id!");
            cleanup("no_agent_id");
            return;
          }

          try {
            agentConfig = await loadAgent();
            console.log(`[SARVAM-BRIDGE] Agent loaded, connecting STT...`);
            connectSTT(agentConfig);

            // Send initial greeting via TTS after a short delay
            setTimeout(async () => {
              if (!closed && agentConfig) {
                const greeting = await chatCompletion("The call has just started. Please greet the caller.");
                await speakViaSarvamTTS(greeting);
              }
            }, 1500);
          } catch (e) {
            console.error("[SARVAM-BRIDGE] Agent load failed:", e);
            cleanup("agent_load_failed");
          }
        } else if (msg.event === "media" && msg.media?.payload) {
          // Forward raw mulaw audio to Sarvam STT
          const audioData = b64decode(msg.media.payload);

          if (sttWs && sttWs.readyState === WebSocket.OPEN && sttReady) {
            sttWs.send(audioData);
          } else {
            audioBuffer.push(audioData);
            if (audioBuffer.length > 500) audioBuffer.shift();
          }
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
