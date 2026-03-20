import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requirePositiveBalance } from "../_shared/minute-balance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeUltravoxLanguageHint(languageHint: string | null | undefined) {
  const value = String(languageHint || "").trim();
  if (!value) return "en";

  const normalized = value.toLowerCase();
  const map: Record<string, string> = {
    english: "en",
    en: "en",
    "en-us": "en",
    "en-gb": "en",
    hindi: "hi",
    hi: "hi",
    "hi-in": "hi",
    telugu: "te",
    te: "te",
    "te-in": "te",
    tamil: "ta",
    ta: "ta",
    "ta-in": "ta",
    kannada: "kn",
    kn: "kn",
    "kn-in": "kn",
    malayalam: "ml",
    ml: "ml",
    "ml-in": "ml",
  };

  return map[normalized] || value;
}

async function buildUltravoxCallBody(
  ultravoxApiKey: string,
  agent: any,
  systemPrompt: string,
  selectedTools: any[],
) {
  const dedupedSelectedTools = selectedTools.filter((tool, index, list) => {
    const toolName = tool?.temporaryTool?.modelToolName;
    if (!toolName) return true;
    return list.findIndex((candidate) => candidate?.temporaryTool?.modelToolName === toolName) === index;
  });

  if (agent.ultravox_agent_id) {
    const response = await fetch(`https://api.ultravox.ai/api/agents/${agent.ultravox_agent_id}`, {
      headers: { "X-API-Key": ultravoxApiKey },
    });

    if (response.ok) {
      const agentData = await response.json();
      const template = agentData?.callTemplate;
      if (template) {
        const callBody: any = {
          systemPrompt: systemPrompt || template.systemPrompt,
          temperature: Number(agent.temperature ?? template.temperature ?? 0.7),
          model: template.model,
          voice: template.voice,
          externalVoice: template.externalVoice,
          languageHint: normalizeUltravoxLanguageHint(agent.language_hint || template.languageHint || "en"),
          initialMessages: template.initialMessages,
          joinTimeout: template.joinTimeout,
          maxDuration: agent.max_duration ? `${agent.max_duration}s` : template.maxDuration || "300s",
          timeExceededMessage: template.timeExceededMessage,
          inactivityMessages: template.inactivityMessages,
          selectedTools: dedupedSelectedTools.length > 0 ? dedupedSelectedTools : template.selectedTools,
          recordingEnabled: template.recordingEnabled,
          firstSpeaker: template.firstSpeaker,
          transcriptOptional: template.transcriptOptional,
          initialOutputMedium: template.initialOutputMedium,
          vadSettings: template.vadSettings,
          firstSpeakerSettings: template.firstSpeakerSettings,
          experimentalSettings: template.experimentalSettings,
          metadata: template.metadata,
          initialState: template.initialState,
          dataConnection: template.dataConnection,
          callbacks: template.callbacks,
          voiceOverrides: template.voiceOverrides,
        };
        return callBody;
      }
    }
  }

  let modelName = agent.model || "fixie-ai/ultravox-v0.7";
  if (modelName && !modelName.includes("/")) {
    modelName = `fixie-ai/${modelName}`;
  }

  const callBody: any = {
    systemPrompt,
    model: modelName,
    voice: agent.voice,
    temperature: Number(agent.temperature),
    firstSpeakerSettings: agent.first_speaker === "FIRST_SPEAKER_AGENT" ? { agent: {} } : { user: {} },
    languageHint: normalizeUltravoxLanguageHint(agent.language_hint || "en"),
    maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
  };
  if (dedupedSelectedTools.length > 0) {
    callBody.selectedTools = dedupedSelectedTools;
  }
  return callBody;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");

    if (!ultravoxApiKey) {
      return new Response(JSON.stringify({ error: "ULTRAVOX_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    const userId = typeof payload?.sub === "string" ? payload.sub : null;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized", details: "Unable to resolve user from token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { agent_id } = await req.json();
    if (!agent_id) {
      return new Response(JSON.stringify({ error: "agent_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await requirePositiveBalance(supabase as any, userId);

    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .eq("user_id", userId)
      .single();

    if (agentError || !agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: kbItems }, { data: agentTools }, { data: appointmentTools }, { data: forwardingNumbers }] = await Promise.all([
      supabase.from("knowledge_base_items").select("*").eq("agent_id", agent.id),
      supabase.from("agent_tools").select("*").eq("agent_id", agent.id).eq("is_active", true),
      supabase.from("appointment_tools").select("*, calendar_integrations(*)").eq("agent_id", agent.id).eq("is_active", true),
      supabase.from("call_forwarding_numbers").select("*").eq("agent_id", agent.id).order("priority", { ascending: true }),
    ]);

    const now = new Date();
    let systemPrompt = agent.system_prompt;
    systemPrompt += `\n\n--- CURRENT DATE & TIME ---\nToday is ${now.toISOString().split("T")[0]} (${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}). Current time (UTC): ${now.toISOString()}.\n`;

    if (kbItems && kbItems.length > 0) {
      systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
      for (const item of kbItems) {
        if (item.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
        else if (item.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
      }
    }

    const ultravoxTools: any[] = [];
    const KNOWN_VALUE_MAP: Record<string, string> = {
      "call.id": "KNOWN_PARAM_CALL_ID",
      "call.stage_id": "KNOWN_PARAM_CALL_STAGE_ID",
      "call.state": "KNOWN_PARAM_CALL_STATE",
      "call.conversation_history": "KNOWN_PARAM_CONVERSATION_HISTORY",
      "call.sample_rate": "KNOWN_PARAM_CALL_SAMPLE_RATE",
    };
    const locationToUltravox = (loc: string) => {
      if (loc === "header") return "PARAMETER_LOCATION_HEADER";
      if (loc === "query") return "PARAMETER_LOCATION_QUERY";
      return "PARAMETER_LOCATION_BODY";
    };
    const END_BEHAVIOR_MAP: Record<string, string> = {
      "Speaks": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS",
      "Listens": "AGENT_TEXT_BEHAVIOR_AGENT_LISTENS",
      "Speaks Once": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS_ONCE",
    };

    if (agentTools && agentTools.length > 0) {
      for (const tool of agentTools) {
        const dynamicParameters: any[] = [];
        const automaticParameters: any[] = [];

        if (Array.isArray(tool.parameters)) {
          for (const p of tool.parameters as any[]) {
            if (p.paramType === "automatic") {
              automaticParameters.push({
                name: p.name,
                location: locationToUltravox(p.location),
                knownValue: KNOWN_VALUE_MAP[p.knownValue] || p.knownValue,
              });
            } else {
              dynamicParameters.push({
                name: p.name,
                location: locationToUltravox(p.location),
                schema: p.schema || { type: p.type || "string", description: p.description || "" },
                required: !!p.required,
              });
            }
          }
        }

        const staticParameters: any[] = [];
        if (tool.http_headers && typeof tool.http_headers === "object") {
          for (const [headerName, headerValue] of Object.entries(tool.http_headers as Record<string, string>)) {
            if (headerName && headerValue) {
              staticParameters.push({
                name: headerName,
                location: "PARAMETER_LOCATION_HEADER",
                value: headerValue,
              });
            }
          }
        }
        if (tool.http_body_template && typeof tool.http_body_template === "object") {
          for (const [key, value] of Object.entries(tool.http_body_template as Record<string, any>)) {
            if (key.startsWith("__")) continue;
            staticParameters.push({
              name: key,
              location: "PARAMETER_LOCATION_BODY",
              value: String(value),
            });
          }
        }

        const bodyMeta = (tool.http_body_template as Record<string, any>) || {};
        const temporaryTool: any = {
          modelToolName: tool.name,
          description: tool.description,
          dynamicParameters,
          http: {
            baseUrlPattern: tool.http_url,
            httpMethod: tool.http_method,
          },
        };
        if (staticParameters.length > 0) temporaryTool.staticParameters = staticParameters;
        if (automaticParameters.length > 0) temporaryTool.automaticParameters = automaticParameters;
        if (bodyMeta.__agentEndBehavior && END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior]) {
          temporaryTool.defaultReaction = END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior];
        }
        if (bodyMeta.__staticResponse) {
          temporaryTool.staticResponse = bodyMeta.__staticResponse;
        }

        ultravoxTools.push({ temporaryTool });
      }
    }

    if (appointmentTools && appointmentTools.length > 0) {
      const checkAvailabilityUrl = `${supabaseUrl}/functions/v1/check-calendar-availability`;
      const bookAppointmentUrl = `${supabaseUrl}/functions/v1/book-calendar-appointment`;

      for (const apptTool of appointmentTools) {
        const integration = (apptTool as any).calendar_integrations;
        if (!integration) continue;

        const enabledDays = Object.entries(apptTool.business_hours as Record<string, any>)
          .filter(([_, v]: any) => v.enabled)
          .map(([day, v]: any) => `${day}: ${v.start}-${v.end}`)
          .join(", ");
        const typesList = (apptTool.appointment_types as any[]).map((t: any) => `${t.name} (${t.duration}min)`).join(", ");

        systemPrompt += `\n\n--- APPOINTMENT TOOL: ${apptTool.name} ---`;
        systemPrompt += `\nProvider: ${apptTool.provider}`;
        systemPrompt += `\nBusiness Hours: ${enabledDays}`;
        systemPrompt += `\nAppointment Types: ${typesList}`;
        systemPrompt += `\nUse check_availability_${apptTool.name.replace(/[^a-zA-Z0-9]/g, "_")} to check calendar availability.`;
        systemPrompt += `\nUse book_appointment_${apptTool.name.replace(/[^a-zA-Z0-9]/g, "_")} to book an appointment.\n`;

        const toolNameSuffix = apptTool.name.replace(/[^a-zA-Z0-9]/g, "_");
        const authHeaders = [{ name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey }];

        ultravoxTools.push({
          temporaryTool: {
            modelToolName: `check_availability_${toolNameSuffix}`,
            description: `Check calendar availability for ${apptTool.name}. Returns available time slots for a given date.`,
            dynamicParameters: [
              { name: "date", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Date to check availability (YYYY-MM-DD format)" }, required: true },
              { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Desired meeting duration in minutes" }, required: false },
            ],
            http: { baseUrlPattern: checkAvailabilityUrl, httpMethod: "POST" },
            staticParameters: [
              { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
              { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
              ...authHeaders,
            ],
          },
        });

        ultravoxTools.push({
          temporaryTool: {
            modelToolName: `book_appointment_${toolNameSuffix}`,
            description: `Book an appointment using ${apptTool.name}. Schedule a meeting at a specific date and time.`,
            dynamicParameters: [
              { name: "start_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Start time in ISO 8601 format" }, required: true },
              { name: "end_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "End time in ISO 8601 format. Optional if duration_minutes is provided" }, required: false },
              { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Duration in minutes if end_time is omitted" }, required: false },
              { name: "attendee_name", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Name of the person booking" }, required: true },
              { name: "attendee_email", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Email of the person booking" }, required: false },
              { name: "attendee_phone", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Phone number of the person booking" }, required: false },
              { name: "notes", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Additional notes" }, required: false },
            ],
            http: { baseUrlPattern: bookAppointmentUrl, httpMethod: "POST" },
            staticParameters: [
              { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
              { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
              ...authHeaders,
            ],
          },
        });
      }
    }

    if (forwardingNumbers && forwardingNumbers.length > 0) {
      const numbersList = forwardingNumbers.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
      systemPrompt += `\n\n--- CALL FORWARDING ---`;
      systemPrompt += `\nYou can transfer the caller to a human agent if they request it or if you cannot help them.`;
      systemPrompt += `\nAvailable transfer destinations (in priority order): ${numbersList}`;
      systemPrompt += `\nAlways confirm with the caller before transferring.\n`;
    }

    const ultravoxBody = await buildUltravoxCallBody(
      ultravoxApiKey,
      agent,
      systemPrompt,
      ultravoxTools,
    );

    const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": ultravoxApiKey },
      body: JSON.stringify(ultravoxBody),
    });

    if (!ultravoxResponse.ok) {
      const errorText = await ultravoxResponse.text();
      return new Response(JSON.stringify({ error: "Failed to create demo call", details: errorText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ultravoxData = await ultravoxResponse.json();
    const joinUrl = ultravoxData.joinUrl;
    const ultravoxCallId = ultravoxData.callId;

    const { data: logRow, error: logError } = await supabase
      .from("call_logs")
      .insert({
        user_id: userId,
        agent_id: agent.id,
        direction: "demo",
        caller_number: "browser-demo",
        recipient_number: null,
        ultravox_call_id: ultravoxCallId || null,
        twilio_call_sid: null,
        status: "initiated",
      })
      .select("id")
      .single();

    if (logError) {
      return new Response(JSON.stringify({ error: logError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, joinUrl, callId: ultravoxCallId, logId: logRow.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error creating demo call:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
