// Gemini Live API ↔ Twilio/Telnyx WebSocket bridge
// Zero npm imports — pure Deno for edge function stability
// Now with call forwarding, webhook firing, and calendar via edge functions

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

const GEMINI_SUPPORTED_VOICES = new Set([
  "Kore", "Aoede", "Leda", "Autonoe", "Erinome", "Laomedeia", "Callirrhoe", "Despina",
  "Puck", "Charon", "Fenrir", "Orus", "Vale", "Zephyr", "Umbriel",
  "Schedar", "Achird", "Sadachbia", "Sadaltager", "Iapetus",
]);
const DEFAULT_GEMINI_VOICE = "Kore";

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

// ── Tool type definitions ──
interface CalendarIntegration {
  id: string;
  provider: string;
  api_key: string | null;
  calendar_id: string | null;
  config: any;
  is_active: boolean;
}

interface AgentTool {
  id: string;
  name: string;
  description: string;
  http_method: string;
  http_url: string;
  http_headers: Record<string, string>;
  http_body_template: Record<string, any>;
  parameters: any[];
  is_active: boolean;
}

interface AgentConfig {
  prompt: string;
  model: string;
  voice: string;
  userId: string;
  calendarIntegrations: CalendarIntegration[];
  agentTools: AgentTool[];
  appointmentTools: any[];
  forwardingNumbers: any[];
  webhooks: any[];
}

// ── Main server ──

Deno.serve((req) => {
  console.log("[BRIDGE] === Handler invoked ===");
  try {
    const reqUrl = new URL(req.url);
    const upgradeHeader = req.headers.get("upgrade") || "";
    console.log(`[BRIDGE] method=${req.method} upgrade="${upgradeHeader}" url=${reqUrl.pathname}${reqUrl.search}`);

    if (upgradeHeader.toLowerCase() !== "websocket") {
      return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), { 
        status: 200, headers: { "Content-Type": "application/json" } 
      });
    }

    console.log("[BRIDGE] WebSocket upgrade detected");
    
    let agentId = reqUrl.searchParams.get("agent_id") || "";
    console.log(`[BRIDGE] agent_id from query: "${agentId}"`);

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) return new Response("GEMINI_API_KEY not configured", { status: 500 });

    const sbUrl = Deno.env.get("SUPABASE_URL")!;
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const elevenlabsApiKey = Deno.env.get("ELEVENLABS_API_KEY") || "";

    console.log("[BRIDGE] Calling Deno.upgradeWebSocket...");
    const { socket, response } = Deno.upgradeWebSocket(req);
    console.log("[BRIDGE] WebSocket upgrade success");

  let geminiWs: WebSocket | null = null;
  let streamSid = "";
  let callSid = ""; // For call forwarding
  let telephonyProvider: "twilio" | "telnyx" = "twilio"; // Track actual provider
  let geminiReady = false;
  const audioBuffer: string[] = [];
  let keepaliveTimer: number | null = null;
  let closed = false;
  let agentConfig: AgentConfig | null = null;
  let useHybridMode = false;

  // ── Webhook firing ──
  async function fireWebhooks(event: string, payload: any) {
    if (!agentConfig?.webhooks?.length) return;
    for (const wh of agentConfig.webhooks) {
      if (!wh.is_active || !wh.events?.includes(event)) continue;
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (wh.secret) headers["X-Webhook-Secret"] = wh.secret;
        await fetch(wh.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload }),
        });
        console.log(`[BRIDGE] Webhook fired: ${event} → ${wh.url}`);
      } catch (e) {
        console.error(`[BRIDGE] Webhook error (${wh.url}):`, e);
      }
    }
  }

  function cleanup(reason: string) {
    if (closed) return;
    closed = true;
    console.log(`[BRIDGE] Cleanup: ${reason}`);
    fireWebhooks("call.ended", { agent_id: agentId, call_sid: callSid, reason });
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    try { if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close(); } catch (_e) { /* ignore */ }
    try { if (socket.readyState === WebSocket.OPEN) socket.close(); } catch (_e) { /* ignore */ }
  }

  // ── Load agent config including tools, calendar, forwarding, webhooks ──
  async function loadAgent(): Promise<AgentConfig> {
    let prompt = "You are a helpful AI assistant on a phone call. Be conversational and natural.";
    let model = DEFAULT_GEMINI_MODEL;
    let voice = "Puck";
    let userId = "";
    let calendarIntegrations: CalendarIntegration[] = [];
    let agentTools: AgentTool[] = [];
    let appointmentTools: any[] = [];
    let forwardingNumbers: any[] = [];
    let webhooks: any[] = [];

    try {
      const headers: Record<string, string> = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

      const [agentRes, toolsRes, kbRes, apptRes, fwdRes] = await Promise.all([
        fetch(`${sbUrl}/rest/v1/agents?id=eq.${agentId}&select=system_prompt,model,voice,user_id`, { headers }),
        fetch(`${sbUrl}/rest/v1/agent_tools?agent_id=eq.${agentId}&is_active=eq.true&select=*`, { headers }),
        fetch(`${sbUrl}/rest/v1/knowledge_base_items?agent_id=eq.${agentId}&select=title,content,website_url`, { headers }),
        fetch(`${sbUrl}/rest/v1/appointment_tools?agent_id=eq.${agentId}&is_active=eq.true&select=*,calendar_integrations(*)`, { headers }),
        fetch(`${sbUrl}/rest/v1/call_forwarding_numbers?agent_id=eq.${agentId}&order=priority.asc&select=*`, { headers }),
      ]);

      if (!agentRes.ok) {
        console.error(`[BRIDGE] Agent fetch failed: ${agentRes.status} ${await agentRes.text()}`);
        return { prompt, model, voice, userId, calendarIntegrations, agentTools, appointmentTools, forwardingNumbers, webhooks };
      }

      const agents = await agentRes.json();
      if (agents?.length > 0) {
        prompt = agents[0].system_prompt || prompt;
        userId = agents[0].user_id || "";
        const rawModel = agents[0].model || "";
        if (rawModel.includes("gemini")) model = rawModel;
        const rawVoice = agents[0].voice || "Kore";
        voice = rawVoice;
        console.log(`[BRIDGE] Agent voice: using="${voice}" model="${model}" userId="${userId}"`);
      }

      if (toolsRes.ok) {
        const tools = await toolsRes.json();
        if (tools?.length > 0) {
          agentTools = tools;
          console.log(`[BRIDGE] Loaded ${agentTools.length} custom agent tools`);
        }
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

      if (apptRes.ok) {
        const appts = await apptRes.json();
        if (appts?.length > 0) {
          appointmentTools = appts;
          for (const at of appts) {
            if (at.calendar_integrations) {
              calendarIntegrations.push(at.calendar_integrations);
            }
          }
          console.log(`[BRIDGE] Loaded ${appointmentTools.length} appointment tools`);
        }
      }

      if (fwdRes.ok) {
        const fwds = await fwdRes.json();
        if (fwds?.length > 0) {
          forwardingNumbers = fwds;
          const numbersList = fwds.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
          prompt += `\n\n--- CALL FORWARDING ---`;
          prompt += `\nYou can transfer the caller to a human agent. Available: ${numbersList}`;
          prompt += `\nAlways confirm with the caller before transferring.`;
          console.log(`[BRIDGE] Loaded ${forwardingNumbers.length} forwarding numbers`);
        }
      }

      // Add appointment context to prompt
      for (const at of appointmentTools) {
        const enabledDays = Object.entries(at.business_hours as Record<string, any>)
          .filter(([_, v]: any) => v.enabled)
          .map(([day, v]: any) => `${day}: ${v.start}-${v.end}`)
          .join(", ");
        const typesList = (at.appointment_types as any[]).map((t: any) => `${t.name} (${t.duration}min)`).join(", ");
        prompt += `\n\n--- APPOINTMENT TOOL: ${at.name} ---`;
        prompt += `\nProvider: ${at.provider}`;
        prompt += `\nBusiness Hours: ${enabledDays}`;
        prompt += `\nAppointment Types: ${typesList}`;
      }

      // Fetch webhooks
      if (userId) {
        const whRes = await fetch(
          `${sbUrl}/rest/v1/webhooks?agent_id=eq.${agentId}&is_active=eq.true&select=*`,
          { headers }
        );
        if (whRes.ok) {
          const whs = await whRes.json();
          if (whs?.length > 0) webhooks = whs;
        }
      }
    } catch (e) {
      console.error("[BRIDGE] Agent load error:", e);
    }

    return { prompt, model, voice, userId, calendarIntegrations, agentTools, appointmentTools, forwardingNumbers, webhooks };
  }

  // ── Build Gemini function declarations for tools ──
  function buildFunctionDeclarations(config: AgentConfig): any[] {
    const declarations: any[] = [];

    // Calendar tools — from appointment_tools with calendar_integrations
    if (config.appointmentTools.length > 0) {
      declarations.push({
        name: "check_calendar_availability",
        description: "Check available time slots on the calendar for a given date.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING", description: "Date in YYYY-MM-DD format." },
            duration_minutes: { type: "NUMBER", description: "Duration in minutes. Default 30." },
          },
          required: ["date"],
        },
      });

      declarations.push({
        name: "book_appointment",
        description: "Book an appointment at a specific date and time.",
        parameters: {
          type: "OBJECT",
          properties: {
            start_time: { type: "STRING", description: "Start time in ISO 8601 format." },
            end_time: { type: "STRING", description: "End time in ISO 8601 format." },
            attendee_name: { type: "STRING", description: "Name of the person booking." },
            attendee_email: { type: "STRING", description: "Email (if provided)." },
            attendee_phone: { type: "STRING", description: "Phone number." },
            notes: { type: "STRING", description: "Additional notes." },
          },
          required: ["start_time", "attendee_name"],
        },
      });
    }

    // Call forwarding tool
    if (config.forwardingNumbers.length > 0) {
      const numbersList = config.forwardingNumbers.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
      declarations.push({
        name: "transfer_call",
        description: `Transfer the call to a human agent. Available: ${numbersList}. Always confirm before transferring.`,
        parameters: {
          type: "OBJECT",
          properties: {},
          required: [],
        },
      });
    }

    // Custom agent tools — only expose dynamic parameters (skip automatic ones)
    for (const tool of config.agentTools) {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      if (Array.isArray(tool.parameters)) {
        for (const param of tool.parameters) {
          // Skip automatic parameters — they are injected at execution time
          if (param.paramType === "automatic") continue;
          const schema = param.schema || { type: param.type || "string", description: param.description || "" };
          properties[param.name] = {
            type: (schema.type || "string").toUpperCase(),
            description: schema.description || param.description || "",
          };
          if (param.required) required.push(param.name);
        }
      }

      declarations.push({
        name: tool.name,
        description: tool.description,
        parameters: { type: "OBJECT", properties, required },
      });
    }

    return declarations;
  }

  // ── Execute tool calls via edge functions ──
  async function executeToolCall(functionName: string, args: Record<string, any>): Promise<any> {
    console.log(`[BRIDGE] Executing tool call: ${functionName}`, JSON.stringify(args));

    try {
      if (functionName === "check_calendar_availability" && agentConfig) {
        const appt = agentConfig.appointmentTools[0];
        const cal = appt?.calendar_integrations as any;
        if (!cal?.id) return { error: "No calendar integration configured" };

        const res = await fetch(`${sbUrl}/functions/v1/check-calendar-availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
          body: JSON.stringify({
            provider: cal.provider,
            integration_id: cal.id,
            date: args.date,
            duration_minutes: args.duration_minutes || 30,
          }),
        });
        return await res.json();
      }

      if (functionName === "book_appointment" && agentConfig) {
        const appt = agentConfig.appointmentTools[0];
        const cal = appt?.calendar_integrations as any;
        if (!cal?.id) return { error: "No calendar integration configured" };

        const res = await fetch(`${sbUrl}/functions/v1/book-calendar-appointment`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
          body: JSON.stringify({
            provider: appt.provider || cal.provider,
            integration_id: cal.id,
            start_time: args.start_time,
            end_time: args.end_time,
            attendee_name: args.attendee_name,
            attendee_email: args.attendee_email,
            attendee_phone: args.attendee_phone,
            notes: args.notes,
          }),
        });
        return await res.json();
      }

      if (functionName === "transfer_call") {
        if (!callSid) return { error: "No call SID available for transfer" };
        const res = await fetch(`${sbUrl}/functions/v1/transfer-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sbKey}` },
          body: JSON.stringify({
            call_sid: callSid,
            agent_id: agentId,
            provider: telephonyProvider,
          }),
        });
        return await res.json();
      }

      // Custom agent tool
      if (agentConfig) {
        const tool = agentConfig.agentTools.find(t => t.name === functionName);
        if (tool) {
          return await executeCustomTool(tool, args);
        }
      }

      return { error: `Unknown tool: ${functionName}` };
    } catch (e) {
      console.error(`[BRIDGE] Tool execution error (${functionName}):`, e);
      return { error: `Tool execution failed: ${e.message || String(e)}` };
    }
  }

  // ── Execute custom HTTP tool — merge args into body + inject automatic params ──
  async function executeCustomTool(tool: AgentTool, args: Record<string, any>): Promise<any> {
    let url = tool.http_url;

    // Inject automatic parameters (Gemini doesn't have knownValue, so we do it here)
    const mergedArgs = { ...args };
    if (Array.isArray(tool.parameters)) {
      for (const p of tool.parameters as any[]) {
        if (p.paramType === "automatic") {
          if (p.knownValue === "call.id") mergedArgs[p.name] = callSid;
        }
      }
    }

    // Replace URL placeholders
    for (const [key, value] of Object.entries(mergedArgs)) {
      url = url.replace(`{{${key}}}`, encodeURIComponent(String(value)));
    }

    let body: string | undefined;
    if (tool.http_method !== "GET") {
      // Merge body template with dynamic args
      const bodyObj: Record<string, any> = {};
      if (tool.http_body_template && typeof tool.http_body_template === "object") {
        Object.assign(bodyObj, tool.http_body_template);
        delete bodyObj.__agentEndBehavior;
        delete bodyObj.__staticResponse;
      }
      // Merge dynamic + automatic args for body params
      if (Array.isArray(tool.parameters)) {
        for (const p of tool.parameters as any[]) {
          if (p.location === "body" || !p.location) {
            if (mergedArgs[p.name] !== undefined) bodyObj[p.name] = mergedArgs[p.name];
          }
        }
      }
      // Also merge any remaining args
      for (const [key, value] of Object.entries(mergedArgs)) {
        if (!(key in bodyObj)) bodyObj[key] = value;
      }
      body = JSON.stringify(bodyObj);
    }

    const fetchHeaders: Record<string, string> = { "Content-Type": "application/json", ...tool.http_headers };
    // Inject automatic header params
    if (Array.isArray(tool.parameters)) {
      for (const p of tool.parameters as any[]) {
        if (p.paramType === "automatic" && p.location === "header" && mergedArgs[p.name]) {
          fetchHeaders[p.name] = String(mergedArgs[p.name]);
        }
      }
    }

    const res = await fetch(url, {
      method: tool.http_method,
      headers: fetchHeaders,
      body: tool.http_method !== "GET" ? body : undefined,
    });

    const data = await res.json().catch(() => ({ status: res.status, statusText: res.statusText }));
    return data;
  }

  // ── ElevenLabs TTS ──
  async function speakViaElevenLabs(text: string, voiceId: string) {
    if (!text.trim() || !elevenlabsApiKey) return;
    console.log(`[BRIDGE] ElevenLabs TTS: voice=${voiceId} text="${text.substring(0, 80)}..."`);
    try {
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=ulaw_8000`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenlabsApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_turbo_v2_5",
          }),
        }
      );
      if (!ttsRes.ok) {
        console.error(`[BRIDGE] ElevenLabs TTS error: ${ttsRes.status} ${await ttsRes.text()}`);
        return;
      }
      const reader = ttsRes.body?.getReader();
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && socket.readyState === WebSocket.OPEN && !closed) {
          socket.send(JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: b64encode(value) },
          }));
        }
      }
      console.log("[BRIDGE] ElevenLabs TTS audio sent to telephony");
    } catch (e) {
      console.error("[BRIDGE] ElevenLabs TTS error:", e);
    }
  }

  // ── Connect to Gemini Live API ──
  function connectGemini(config: AgentConfig) {
    const { prompt, model, voice } = config;

    const isNativeVoice = GEMINI_SUPPORTED_VOICES.has(voice);
    useHybridMode = !isNativeVoice && !!elevenlabsApiKey;

    const geminiVoice = isNativeVoice ? voice : DEFAULT_GEMINI_VOICE;
    console.log(`[BRIDGE] Mode: ${useHybridMode ? "HYBRID (Gemini text + ElevenLabs TTS)" : "NATIVE audio"}`);
    console.log(`[BRIDGE] Connecting to Gemini: model=models/${model} voice=${useHybridMode ? `ElevenLabs:${voice}` : geminiVoice}`);

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
        let setupMsg: any;

        if (useHybridMode) {
          setupMsg = {
            setup: {
              model: `models/${model}`,
              generationConfig: { responseModalities: ["TEXT"] },
              systemInstruction: { parts: [{ text: prompt + "\n\nIMPORTANT: Keep your responses concise and conversational since they will be spoken aloud. Do not use markdown, lists, or formatting." }] },
            },
          };
        } else {
          setupMsg = {
            setup: {
              model: `models/${model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } },
                },
              },
              systemInstruction: { parts: [{ text: prompt }] },
            },
          };
        }

        const functionDeclarations = buildFunctionDeclarations(config);
        if (functionDeclarations.length > 0) {
          setupMsg.setup.tools = [{ functionDeclarations }];
          console.log(`[BRIDGE] Registered ${functionDeclarations.length} tools with Gemini`);
        }

        geminiWs!.send(JSON.stringify(setupMsg));
        console.log("[BRIDGE] Gemini setup message sent");
      } catch (e) {
        console.error("[BRIDGE] Error sending Gemini setup:", e);
        cleanup("gemini_setup_send_error");
      }
    };

    let pendingText = "";
    let ttsTimeout: number | null = null;

    geminiWs.onmessage = async (ev) => {
      try {
        let text: string;
        if (typeof ev.data === "string") {
          text = ev.data;
        } else if (ev.data instanceof Blob) {
          text = await ev.data.text();
        } else if (ev.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(ev.data);
        } else {
          console.log("[BRIDGE] Gemini sent unknown data type, skipping");
          return;
        }
        if (!text) {
          console.log("[BRIDGE] Gemini sent empty message, skipping");
          return;
        }
        const msg = JSON.parse(text);

        if (msg.setupComplete) {
          console.log("[BRIDGE] Gemini setup complete — ready for audio");
          geminiReady = true;
          const count = audioBuffer.length;
          for (const chunk of audioBuffer) {
            geminiWs!.send(JSON.stringify({
              realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: chunk }] },
            }));
          }
          audioBuffer.length = 0;
          if (count > 0) console.log(`[BRIDGE] Flushed ${count} buffered audio chunks`);

          keepaliveTimer = setInterval(() => {
            try {
              if (geminiWs?.readyState === WebSocket.OPEN && geminiReady) {
                const silence = new Uint8Array(640);
                geminiWs.send(JSON.stringify({
                  realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64encode(silence) }] },
                }));
              }
            } catch (_e) { /* ignore keepalive errors */ }
          }, 15000) as unknown as number;
          return;
        }

        // ── Handle tool calls from Gemini ──
        const toolCall = msg.toolCall;
        if (toolCall && toolCall.functionCalls) {
          console.log(`[BRIDGE] Gemini requesting ${toolCall.functionCalls.length} tool call(s)`);

          const functionResponses: any[] = [];
          for (const fc of toolCall.functionCalls) {
            console.log(`[BRIDGE] Tool call: ${fc.name} args=${JSON.stringify(fc.args)}`);
            const result = await executeToolCall(fc.name, fc.args || {});
            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { result },
            });
            console.log(`[BRIDGE] Tool result for ${fc.name}: ${JSON.stringify(result).substring(0, 200)}`);
          }

          if (geminiWs?.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              toolResponse: { functionResponses },
            }));
            console.log("[BRIDGE] Sent tool responses to Gemini");
          }
          return;
        }

        // Handle responses from Gemini
        const parts = (msg.serverContent as any)?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (useHybridMode && part.text) {
              pendingText += part.text;
              const sentenceMatch = pendingText.match(/^(.*[.!?])\s*/s);
              if (sentenceMatch) {
                const sentence = sentenceMatch[1];
                pendingText = pendingText.slice(sentenceMatch[0].length);
                if (ttsTimeout) clearTimeout(ttsTimeout);
                await speakViaElevenLabs(sentence, voice);
              }
            } else if (!useHybridMode && part.inlineData?.data && part.inlineData.mimeType?.includes("audio/pcm")) {
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

        if ((msg.serverContent as any)?.turnComplete) {
          console.log("[BRIDGE] Gemini turn complete");
          if (useHybridMode && pendingText.trim()) {
            await speakViaElevenLabs(pendingText.trim(), voice);
            pendingText = "";
          }
          if (ttsTimeout) { clearTimeout(ttsTimeout); ttsTimeout = null; }
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
        callSid = msg.start?.callSid || msg.start?.call_sid || "";
        
        const customParams = msg.start?.customParameters || {};
        if (customParams.agent_id && !agentId) {
          agentId = customParams.agent_id;
          console.log(`[BRIDGE] Got agent_id from customParameters: ${agentId}`);
        }
        // Detect provider from stream event
        if (customParams.provider === "telnyx" || (!msg.start?.streamSid && msg.start?.stream_id)) {
          telephonyProvider = "telnyx";
        }
        
        console.log(`[BRIDGE] Stream started: sid=${streamSid} agent_id=${agentId} callSid=${callSid} provider=${telephonyProvider}`);
        console.log(`[BRIDGE] Start event keys: ${JSON.stringify(Object.keys(msg.start || {}))}`);

        if (!agentId) {
          console.error("[BRIDGE] No agent_id available from query params or customParameters!");
          cleanup("no_agent_id");
          return;
        }

        try {
          agentConfig = await loadAgent();
          console.log(`[BRIDGE] Agent loaded: ${agentConfig.agentTools.length} tools, ${agentConfig.appointmentTools.length} appt, ${agentConfig.forwardingNumbers.length} fwd, ${agentConfig.webhooks.length} webhooks`);
          
          // Resolve Telnyx call_control_id if missing
          if (telephonyProvider === "telnyx" && !callSid && agentId) {
            const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
            // Try telnyx_call_state first (most reliable)
            try {
              const stateRes = await fetch(
                `${sbUrl}/rest/v1/telnyx_call_state?agent_id=eq.${agentId}&order=created_at.desc&limit=1&select=call_control_id`,
                { headers }
              );
              if (stateRes.ok) {
                const rows = await stateRes.json();
                if (rows?.[0]?.call_control_id) {
                  callSid = rows[0].call_control_id;
                  console.log(`[BRIDGE] Resolved Telnyx call_control_id from telnyx_call_state: ${callSid}`);
                }
              }
            } catch (e) { console.warn("[BRIDGE] telnyx_call_state lookup failed:", e); }
            // Fallback: try call_logs
            if (!callSid) {
              try {
                const logRes = await fetch(
                  `${sbUrl}/rest/v1/call_logs?agent_id=eq.${agentId}&status=in.(initiated,in-progress)&order=created_at.desc&limit=1&select=twilio_call_sid`,
                  { headers }
                );
                if (logRes.ok) {
                  const rows = await logRes.json();
                  if (rows?.[0]?.twilio_call_sid) {
                    callSid = rows[0].twilio_call_sid;
                    console.log(`[BRIDGE] Resolved Telnyx call_control_id from call_logs: ${callSid}`);
                  }
                }
              } catch (e) { console.warn("[BRIDGE] call_logs lookup failed:", e); }
            }
          }
          
          // Fire call.started webhook
          fireWebhooks("call.started", { agent_id: agentId, call_sid: callSid, stream_sid: streamSid });
          
          connectGemini(agentConfig);
        } catch (e) {
          console.error("[BRIDGE] Failed to load agent:", e);
          cleanup("agent_load_failed");
        }
      } else if (msg.event === "media" && msg.media?.payload) {
        const mu = b64decode(msg.media.payload);
        const pcm = mulawToPcm16k(mu);
        const pcmB64 = b64encode(pcm);

        if (geminiWs && geminiWs.readyState === WebSocket.OPEN && geminiReady) {
          geminiWs.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: pcmB64 }] },
          }));
        } else {
          audioBuffer.push(pcmB64);
          if (audioBuffer.length > 500) audioBuffer.shift();
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
