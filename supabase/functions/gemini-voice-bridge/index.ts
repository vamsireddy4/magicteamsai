import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Mulaw decode table
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMulawTable() {
  for (let i = 0; i < 256; i++) {
    let val = ~i & 0xFF;
    const sign = val & 0x80;
    const exponent = (val >> 4) & 0x07;
    const mantissa = val & 0x0F;
    let magnitude = ((mantissa << 1) + 33) << (exponent + 2);
    magnitude -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
  }
})();

function mulawEncode(sample: number): number {
  const MAX = 32635;
  const sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > MAX) sample = MAX;
  sample += 0x84;
  let exponent = 7;
  let mask = 0x4000;
  for (; exponent > 0; exponent--, mask >>= 1) {
    if ((sample & mask) !== 0) break;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function mulawToPcm16k(mulawBytes: Uint8Array): Uint8Array {
  const pcmSamples = mulawBytes.length * 2;
  const buffer = new ArrayBuffer(pcmSamples * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < mulawBytes.length; i++) {
    const sample = MULAW_DECODE_TABLE[mulawBytes[i]];
    const nextSample = i + 1 < mulawBytes.length
      ? MULAW_DECODE_TABLE[mulawBytes[i + 1]]
      : sample;
    const interpolated = Math.round((sample + nextSample) / 2);
    view.setInt16(i * 4, sample, true);
    view.setInt16(i * 4 + 2, interpolated, true);
  }
  return new Uint8Array(buffer);
}

function pcm24kToMulaw8k(pcmBytes: Uint8Array): Uint8Array {
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const totalSamples = Math.floor(pcmBytes.length / 2);
  const outputLength = Math.floor(totalSamples / 3);
  const output = new Uint8Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const sample = view.getInt16(i * 6, true);
    output[i] = mulawEncode(sample);
  }
  return output;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

Deno.serve(async (req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", { status: 426 });
  }

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agent_id");

  if (!agentId) {
    return new Response(JSON.stringify({ error: "agent_id required" }), { status: 400 });
  }

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), { status: 500 });
  }

  // CRITICAL: Upgrade WebSocket IMMEDIATELY — before any DB queries
  // Twilio/Telnyx will timeout if the upgrade is delayed
  const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);

  let geminiWs: WebSocket | null = null;
  let streamSid = "";
  let geminiReady = false;
  const pendingAudioChunks: string[] = [];

  // Agent config will be loaded asynchronously after WS connects
  let systemPrompt = "";
  let geminiModel = "gemini-2.0-flash-live-001";
  let geminiVoice = "Puck";
  let agentConfigLoaded = false;

  // Load agent config in background (non-blocking)
  async function loadAgentConfig() {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: agent } = await supabase.from("agents").select("*").eq("id", agentId).single();
      if (!agent) {
        console.error("Agent not found:", agentId);
        twilioWs.close();
        return;
      }

      systemPrompt = agent.system_prompt;
      geminiModel = agent.model || "gemini-2.0-flash-live-001";
      geminiVoice = agent.voice || "Puck";

      const { data: kbItems } = await supabase.from("knowledge_base_items").select("*").eq("agent_id", agent.id);
      if (kbItems && kbItems.length > 0) {
        systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
        for (const item of kbItems) {
          if (item.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
          if (item.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
        }
      }

      agentConfigLoaded = true;
      console.log(`Agent config loaded: model=${geminiModel}, voice=${geminiVoice}`);
    } catch (err) {
      console.error("Error loading agent config:", err);
      twilioWs.close();
    }
  }

  twilioWs.onopen = () => {
    console.log("Twilio/Telnyx WebSocket connected");
    // Start loading agent config immediately
    loadAgentConfig();
  };

  twilioWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.event === "start") {
        streamSid = msg.start?.streamSid || msg.start?.stream_id || "";
        console.log(`Stream started: ${streamSid}`);

        // Wait for agent config before connecting to Gemini
        function connectGemini() {
          if (!agentConfigLoaded) {
            setTimeout(connectGemini, 50);
            return;
          }

          console.log("Connecting to Gemini Live API...");
          const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
          geminiWs = new WebSocket(geminiUrl);

          geminiWs.onopen = () => {
            console.log("Gemini WebSocket connected, sending setup...");
            const setup = {
              setup: {
                model: `models/${geminiModel}`,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: {
                        voiceName: geminiVoice,
                      },
                    },
                  },
                },
                systemInstruction: {
                  parts: [{ text: systemPrompt }],
                },
              },
            };
            geminiWs!.send(JSON.stringify(setup));
          };

          geminiWs.onmessage = (geminiEvent) => {
            try {
              const geminiMsg = JSON.parse(geminiEvent.data);

              if (geminiMsg.setupComplete) {
                console.log("Gemini setup complete - ready for audio");
                geminiReady = true;

                // Flush buffered audio
                const bufferedCount = pendingAudioChunks.length;
                for (const chunk of pendingAudioChunks) {
                  geminiWs!.send(JSON.stringify({
                    realtimeInput: {
                      mediaChunks: [{
                        mimeType: "audio/pcm;rate=16000",
                        data: chunk,
                      }],
                    },
                  }));
                }
                pendingAudioChunks.length = 0;
                if (bufferedCount > 0) {
                  console.log(`Flushed ${bufferedCount} buffered audio chunks`);
                }
                return;
              }

              if (geminiMsg.serverContent?.modelTurn?.parts) {
                for (const part of geminiMsg.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data && part.inlineData.mimeType?.includes("audio/pcm")) {
                    const pcmBytes = base64ToUint8Array(part.inlineData.data);
                    const mulawBytes = pcm24kToMulaw8k(pcmBytes);
                    const payload = uint8ArrayToBase64(mulawBytes);

                    if (twilioWs.readyState === WebSocket.OPEN) {
                      twilioWs.send(JSON.stringify({
                        event: "media",
                        streamSid,
                        media: { payload },
                      }));
                    }
                  }
                }
              }

              if (geminiMsg.serverContent?.turnComplete) {
                console.log("Gemini turn complete");
              }

              if (geminiMsg.error) {
                console.error("Gemini error:", JSON.stringify(geminiMsg.error));
              }
            } catch (err) {
              console.error("Error processing Gemini message:", err);
            }
          };

          geminiWs.onerror = (err) => {
            console.error("Gemini WebSocket error:", err);
          };

          geminiWs.onclose = (closeEvent) => {
            console.log(`Gemini WebSocket closed: code=${closeEvent.code}, reason=${closeEvent.reason}`);
            geminiReady = false;
            setTimeout(() => {
              if (twilioWs.readyState === WebSocket.OPEN) {
                twilioWs.close();
              }
            }, 500);
          };
        }

        connectGemini();

      } else if (msg.event === "media") {
        const mulawBytes = base64ToUint8Array(msg.media.payload);
        const pcmBytes = mulawToPcm16k(mulawBytes);
        const pcmBase64 = uint8ArrayToBase64(pcmBytes);

        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          if (geminiReady) {
            geminiWs.send(JSON.stringify({
              realtimeInput: {
                mediaChunks: [{
                  mimeType: "audio/pcm;rate=16000",
                  data: pcmBase64,
                }],
              },
            }));
          } else {
            pendingAudioChunks.push(pcmBase64);
            if (pendingAudioChunks.length > 200) {
              pendingAudioChunks.shift();
            }
          }
        }
      } else if (msg.event === "stop") {
        console.log("Stream stopped");
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.close();
        }
      }
    } catch (err) {
      console.error("Error processing Twilio message:", err);
    }
  };

  twilioWs.onclose = () => {
    console.log("Twilio/Telnyx WebSocket closed");
    geminiReady = false;
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  };

  twilioWs.onerror = (err) => {
    console.error("Twilio/Telnyx WebSocket error:", err);
  };

  return response;
});
