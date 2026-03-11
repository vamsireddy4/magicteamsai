// Gemini Live API ↔ Twilio/Telnyx WebSocket bridge
// Zero npm imports — pure Deno for edge function stability

// Voice is passed directly from agent config — no whitelist filtering

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

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
    
    let agentId = reqUrl.searchParams.get("agent_id") || "";
    console.log(`[BRIDGE] agent_id from query: "${agentId}"`);

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
  let agentConfig: AgentConfig | null = null;

  // ── Cleanup helper ──
  function cleanup(reason: string) {
    if (closed) return;
    closed = true;
    console.log(`[BRIDGE] Cleanup: ${reason}`);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    try { if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close(); } catch (_e) { /* ignore */ }
    try { if (socket.readyState === WebSocket.OPEN) socket.close(); } catch (_e) { /* ignore */ }
  }

  // ── Load agent config including tools and calendar integrations ──
  async function loadAgent(): Promise<AgentConfig> {
    let prompt = "You are a helpful AI assistant on a phone call. Be conversational and natural.";
    let model = DEFAULT_GEMINI_MODEL;
    let voice = "Puck";
    let userId = "";
    let calendarIntegrations: CalendarIntegration[] = [];
    let agentTools: AgentTool[] = [];

    try {
      const headers: Record<string, string> = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

      // Fetch agent, tools, and knowledge base in parallel
      const [agentRes, toolsRes, kbRes] = await Promise.all([
        fetch(`${sbUrl}/rest/v1/agents?id=eq.${agentId}&select=system_prompt,model,voice,user_id`, { headers }),
        fetch(`${sbUrl}/rest/v1/agent_tools?agent_id=eq.${agentId}&is_active=eq.true&select=*`, { headers }),
        fetch(`${sbUrl}/rest/v1/knowledge_base_items?agent_id=eq.${agentId}&select=title,content,website_url`, { headers }),
      ]);

      if (!agentRes.ok) {
        console.error(`[BRIDGE] Agent fetch failed: ${agentRes.status} ${await agentRes.text()}`);
        return { prompt, model, voice, userId, calendarIntegrations, agentTools };
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

      // Parse agent tools
      if (toolsRes.ok) {
        const tools = await toolsRes.json();
        if (tools?.length > 0) {
          agentTools = tools;
          console.log(`[BRIDGE] Loaded ${agentTools.length} custom agent tools`);
        }
      }

      // Parse KB items
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

      // Fetch calendar integrations for this user
      if (userId) {
        const calRes = await fetch(
          `${sbUrl}/rest/v1/calendar_integrations?user_id=eq.${userId}&is_active=eq.true&select=id,provider,api_key,calendar_id,config`,
          { headers }
        );
        if (calRes.ok) {
          const cals = await calRes.json();
          if (cals?.length > 0) {
            calendarIntegrations = cals;
            console.log(`[BRIDGE] Loaded ${calendarIntegrations.length} calendar integrations`);
          }
        }
      }
    } catch (e) {
      console.error("[BRIDGE] Agent load error:", e);
    }

    return { prompt, model, voice, userId, calendarIntegrations, agentTools };
  }

  // ── Build Gemini function declarations for tools ──
  function buildFunctionDeclarations(config: AgentConfig): any[] {
    const declarations: any[] = [];

    // Calendar tools — only if user has active calendar integrations
    if (config.calendarIntegrations.length > 0) {
      declarations.push({
        name: "check_calendar_availability",
        description: "Check available time slots on the calendar for a given date. Use this when the caller wants to book an appointment or check availability.",
        parameters: {
          type: "OBJECT",
          properties: {
            date: {
              type: "STRING",
              description: "The date to check availability for, in YYYY-MM-DD format. If the caller says 'tomorrow', 'next Monday', etc., convert it to a date.",
            },
            duration_minutes: {
              type: "NUMBER",
              description: "Duration of the appointment in minutes. Default is 30.",
            },
          },
          required: ["date"],
        },
      });

      declarations.push({
        name: "book_appointment",
        description: "Book an appointment at a specific date and time. Use this after checking availability and the caller has chosen a time slot.",
        parameters: {
          type: "OBJECT",
          properties: {
            start_time: {
              type: "STRING",
              description: "The start time of the appointment in ISO 8601 format (e.g., 2025-03-15T10:00:00Z).",
            },
            end_time: {
              type: "STRING",
              description: "The end time of the appointment in ISO 8601 format.",
            },
            attendee_name: {
              type: "STRING",
              description: "The name of the person booking the appointment.",
            },
            attendee_email: {
              type: "STRING",
              description: "The email of the person booking the appointment (if provided).",
            },
            attendee_phone: {
              type: "STRING",
              description: "The phone number of the person booking the appointment.",
            },
            notes: {
              type: "STRING",
              description: "Any additional notes about the appointment.",
            },
          },
          required: ["start_time", "attendee_name"],
        },
      });
    }

    // Custom agent tools from agent_tools table
    for (const tool of config.agentTools) {
      const properties: Record<string, any> = {};
      const required: string[] = [];

      if (Array.isArray(tool.parameters)) {
        for (const param of tool.parameters) {
          properties[param.name] = {
            type: (param.type || "string").toUpperCase(),
            description: param.description || "",
          };
          if (param.required) required.push(param.name);
        }
      }

      declarations.push({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "OBJECT",
          properties,
          required,
        },
      });
    }

    return declarations;
  }

  // ── Execute tool calls ──
  async function executeToolCall(functionName: string, args: Record<string, any>): Promise<any> {
    console.log(`[BRIDGE] Executing tool call: ${functionName}`, JSON.stringify(args));

    try {
      if (functionName === "check_calendar_availability" && agentConfig) {
        return await executeCalendarAvailability(args, agentConfig.calendarIntegrations);
      }

      if (functionName === "book_appointment" && agentConfig) {
        return await executeBookAppointment(args, agentConfig.calendarIntegrations);
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

  // ── Calendar availability check ──
  async function executeCalendarAvailability(args: Record<string, any>, integrations: CalendarIntegration[]): Promise<any> {
    const results: any[] = [];

    for (const cal of integrations) {
      try {
        if (cal.provider === "cal_com" && cal.api_key) {
          const dateFrom = args.date || new Date().toISOString().split("T")[0];
          const res = await fetch(
            `https://api.cal.com/v1/availability?apiKey=${cal.api_key}&eventTypeId=${cal.calendar_id}&dateFrom=${dateFrom}&dateTo=${dateFrom}`
          );
          if (res.ok) {
            const data = await res.json();
            results.push({ provider: "Cal.com", slots: data.slots || data.busy || [] });
          } else {
            results.push({ provider: "Cal.com", error: `API error: ${res.statusText}` });
          }
        } else if (cal.provider === "google_calendar" && cal.api_key) {
          const calendarId = cal.calendar_id || "primary";
          const timeMin = args.date ? `${args.date}T00:00:00Z` : new Date().toISOString();
          const timeMax = args.date
            ? `${args.date}T23:59:59Z`
            : new Date(Date.now() + 86400000).toISOString();
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${cal.api_key}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
          );
          if (res.ok) {
            const data = await res.json();
            const events = data.items?.map((e: any) => ({
              summary: e.summary,
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
            })) || [];
            results.push({ provider: "Google Calendar", events, message: "These times are already booked. Available times are gaps between these events." });
          } else {
            results.push({ provider: "Google Calendar", error: `API error: ${res.statusText}` });
          }
        } else if (cal.provider === "gohighlevel" && cal.api_key) {
          const startDate = args.date ? new Date(args.date).getTime() : Date.now();
          const endDate = startDate + 86400000;
          const res = await fetch(
            `https://rest.gohighlevel.com/v1/appointments/slots?calendarId=${cal.calendar_id}&startDate=${startDate}&endDate=${endDate}`,
            { headers: { Authorization: `Bearer ${cal.api_key}` } }
          );
          if (res.ok) {
            const data = await res.json();
            results.push({ provider: "GoHighLevel", slots: data.slots || [] });
          } else {
            results.push({ provider: "GoHighLevel", error: `API error: ${res.statusText}` });
          }
        }
      } catch (e) {
        results.push({ provider: cal.provider, error: String(e) });
      }
    }

    return { availability: results };
  }

  // ── Book appointment ──
  async function executeBookAppointment(args: Record<string, any>, integrations: CalendarIntegration[]): Promise<any> {
    // Use the first active calendar integration for booking
    const cal = integrations[0];
    if (!cal) return { error: "No calendar integration configured" };

    try {
      if (cal.provider === "cal_com" && cal.api_key) {
        const res = await fetch(`https://api.cal.com/v1/bookings?apiKey=${cal.api_key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventTypeId: parseInt(cal.calendar_id || "0"),
            start: args.start_time,
            end: args.end_time || new Date(new Date(args.start_time).getTime() + 30 * 60000).toISOString(),
            responses: {
              name: args.attendee_name || "Guest",
              email: args.attendee_email || "guest@example.com",
              phone: args.attendee_phone,
              notes: args.notes,
            },
            timeZone: "UTC",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          return { success: true, provider: "Cal.com", booking: data };
        }
        const err = await res.json().catch(() => ({}));
        return { success: false, provider: "Cal.com", error: err.message || res.statusText };
      }

      if (cal.provider === "gohighlevel" && cal.api_key) {
        const res = await fetch("https://rest.gohighlevel.com/v1/appointments/", {
          method: "POST",
          headers: { Authorization: `Bearer ${cal.api_key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: cal.calendar_id,
            startTime: args.start_time,
            endTime: args.end_time || new Date(new Date(args.start_time).getTime() + 30 * 60000).toISOString(),
            title: `Appointment with ${args.attendee_name || "Guest"}`,
            email: args.attendee_email,
            phone: args.attendee_phone,
            notes: args.notes,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          return { success: true, provider: "GoHighLevel", appointment: data };
        }
        const err = await res.json().catch(() => ({}));
        return { success: false, provider: "GoHighLevel", error: err.message || res.statusText };
      }

      if (cal.provider === "google_calendar") {
        return { success: false, provider: "Google Calendar", message: "Google Calendar booking requires OAuth credentials. Please use Cal.com or GoHighLevel for booking." };
      }

      return { error: `Unsupported calendar provider: ${cal.provider}` };
    } catch (e) {
      return { error: `Booking failed: ${e.message || String(e)}` };
    }
  }

  // ── Execute custom HTTP tool ──
  async function executeCustomTool(tool: AgentTool, args: Record<string, any>): Promise<any> {
    let url = tool.http_url;
    let body: string | undefined;

    // Replace placeholders in URL
    for (const [key, value] of Object.entries(args)) {
      url = url.replace(`{{${key}}}`, encodeURIComponent(String(value)));
    }

    // Build body from template
    if (tool.http_method !== "GET" && tool.http_body_template) {
      let bodyObj = JSON.parse(JSON.stringify(tool.http_body_template));
      // Replace placeholders in body template
      const bodyStr = JSON.stringify(bodyObj);
      let replaced = bodyStr;
      for (const [key, value] of Object.entries(args)) {
        replaced = replaced.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
      }
      body = replaced;
    }

    const fetchHeaders: Record<string, string> = { "Content-Type": "application/json", ...tool.http_headers };

    const res = await fetch(url, {
      method: tool.http_method,
      headers: fetchHeaders,
      body: tool.http_method !== "GET" ? body : undefined,
    });

    const data = await res.json().catch(() => ({ status: res.status, statusText: res.statusText }));
    return data;
  }

  // ── Connect to Gemini Live API ──
  function connectGemini(config: AgentConfig) {
    const { prompt, model, voice } = config;
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
        const setupMsg: any = {
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

        // Add tools if any are available
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

          // Send tool responses back to Gemini
          if (geminiWs?.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              toolResponse: { functionResponses },
            }));
            console.log("[BRIDGE] Sent tool responses to Gemini");
          }
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
        
        const customParams = msg.start?.customParameters || {};
        if (customParams.agent_id && !agentId) {
          agentId = customParams.agent_id;
          console.log(`[BRIDGE] Got agent_id from customParameters: ${agentId}`);
        }
        
        console.log(`[BRIDGE] Stream started: sid=${streamSid} agent_id=${agentId}`);
        console.log(`[BRIDGE] Start event keys: ${JSON.stringify(Object.keys(msg.start || {}))}`);

        if (!agentId) {
          console.error("[BRIDGE] No agent_id available from query params or customParameters!");
          cleanup("no_agent_id");
          return;
        }

        // Load agent THEN connect to Gemini
        try {
          agentConfig = await loadAgent();
          console.log(`[BRIDGE] Agent loaded with ${agentConfig.calendarIntegrations.length} calendar(s) and ${agentConfig.agentTools.length} tool(s), connecting to Gemini...`);
          connectGemini(agentConfig);
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
