import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let callSid = "";
    let from = "";
    let to = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      callSid = (formData.get("CallSid") as string) || (formData.get("call_control_id") as string) || "";
      from = (formData.get("From") as string) || (formData.get("from") as string) || "";
      to = (formData.get("To") as string) || (formData.get("to") as string) || "";
    } else {
      const body = await req.json();
      callSid = body.CallSid || body.call_control_id || "";
      from = body.From || body.from || "";
      to = body.To || body.to || "";
    }

    console.log(`Inbound call from ${from} to ${to}, SID: ${callSid}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");

    if (!ultravoxApiKey) {
      console.error("ULTRAVOX_API_KEY not set");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, the system is not configured. Please try again later.</Say></Response>`,
        { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the phone config for this number
    const { data: phoneConfig } = await supabase
      .from("phone_configs")
      .select("*")
      .eq("phone_number", to)
      .eq("is_active", true)
      .single();

    if (!phoneConfig) {
      console.error(`No phone config found for ${to}`);
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not configured. Goodbye.</Say></Response>`,
        { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
      );
    }

    const provider = phoneConfig.provider || "twilio";

    // Find the active agent linked to this phone config
    const { data: agent } = await supabase
      .from("agents")
      .select("*")
      .eq("phone_number_id", phoneConfig.id)
      .eq("is_active", true)
      .single();

    if (!agent) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no agent is available right now. Goodbye.</Say></Response>`,
        { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
      );
    }

    // Fetch knowledge base, agent tools, appointment tools, and forwarding numbers in parallel
    const [{ data: kbItems }, { data: agentTools }, { data: appointmentTools }, { data: forwardingNumbers }] = await Promise.all([
      supabase.from("knowledge_base_items").select("*").eq("agent_id", agent.id),
      supabase.from("agent_tools").select("*").eq("agent_id", agent.id).eq("is_active", true),
      supabase.from("appointment_tools").select("*, calendar_integrations(*)").eq("agent_id", agent.id).eq("is_active", true),
      supabase.from("call_forwarding_numbers").select("*").eq("agent_id", agent.id).order("priority", { ascending: true }),
    ]);

    let systemPrompt = agent.system_prompt;
    if (kbItems && kbItems.length > 0) {
      systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
      for (const item of kbItems) {
        if (item.content) {
          systemPrompt += `\n## ${item.title}\n${item.content}\n`;
        } else if (item.website_url) {
          systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
        }
      }
    }

    // Build Ultravox tools from agent_tools (full sync matching sync-ultravox-agent logic)
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

    if (agentTools && agentTools.length > 0) {
      for (const tool of agentTools) {
        const dynamicParameters: any[] = [];
        const automaticParameters: any[] = [];

        if (Array.isArray(tool.parameters)) {
          for (const p of tool.parameters as any[]) {
            if (p.paramType === "automatic") {
              const knownValue = KNOWN_VALUE_MAP[p.knownValue] || p.knownValue;
              automaticParameters.push({
                name: p.name,
                location: locationToUltravox(p.location),
                knownValue,
              });
            } else {
              const schema = p.schema || { type: p.type || "string", description: p.description || "" };
              dynamicParameters.push({
                name: p.name,
                location: locationToUltravox(p.location),
                schema,
                required: !!p.required,
              });
            }
          }
        }

        // Build static parameters from headers and body template
        const staticParameters: any[] = [];
        if (tool.http_headers && typeof tool.http_headers === "object") {
          const headers = tool.http_headers as Record<string, string>;
          for (const [headerName, headerValue] of Object.entries(headers)) {
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
          const bodyTemplate = tool.http_body_template as Record<string, any>;
          for (const [key, value] of Object.entries(bodyTemplate)) {
            if (key.startsWith("__")) continue;
            if (key) {
              staticParameters.push({
                name: key,
                location: "PARAMETER_LOCATION_BODY",
                value: String(value),
              });
            }
          }
        }

        const END_BEHAVIOR_MAP: Record<string, string> = {
          "Speaks": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS",
          "Listens": "AGENT_TEXT_BEHAVIOR_AGENT_LISTENS",
          "Speaks Once": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS_ONCE",
        };

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

        // Add defaultReaction and staticResponse from body template metadata
        const bodyMeta = (tool.http_body_template as Record<string, any>) || {};
        if (bodyMeta.__agentEndBehavior && END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior]) {
          temporaryTool.defaultReaction = END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior];
        }
        if (bodyMeta.__staticResponse) {
          temporaryTool.staticResponse = bodyMeta.__staticResponse;
        }

        ultravoxTools.push({ temporaryTool });
      }
    }

    // Build Ultravox tools from appointment_tools (calendar availability + booking)
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
        systemPrompt += `\nUse check_availability_${apptTool.name.replace(/[^a-zA-Z0-9]/g, '_')} to check calendar availability.`;
        systemPrompt += `\nUse book_appointment_${apptTool.name.replace(/[^a-zA-Z0-9]/g, '_')} to book an appointment.\n`;

        const toolNameSuffix = apptTool.name.replace(/[^a-zA-Z0-9]/g, '_');
        const authHeaders = [
          { name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey },
        ];

        ultravoxTools.push({
          temporaryTool: {
            modelToolName: `check_availability_${toolNameSuffix}`,
            description: `Check calendar availability for ${apptTool.name}. Returns available time slots for a given date.`,
            dynamicParameters: [
              { name: "date", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Date to check availability (YYYY-MM-DD format)" }, required: true },
              { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Desired meeting duration in minutes" }, required: false },
            ],
            http: {
              baseUrlPattern: checkAvailabilityUrl,
              httpMethod: "POST",
            },
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
            http: {
              baseUrlPattern: bookAppointmentUrl,
              httpMethod: "POST",
            },
            staticParameters: [
              { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
              { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
              ...authHeaders,
            ],
          },
        });
      }
    }

    // Inject call forwarding/transfer tool if forwarding numbers exist
    if (forwardingNumbers && forwardingNumbers.length > 0) {
      const transferUrl = `${supabaseUrl}/functions/v1/transfer-call`;
      const numbersList = forwardingNumbers.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
      
      systemPrompt += `\n\n--- CALL FORWARDING ---`;
      systemPrompt += `\nYou can transfer the caller to a human agent if they request it or if you cannot help them.`;
      systemPrompt += `\nAvailable transfer destinations (in priority order): ${numbersList}`;
      systemPrompt += `\nUse the transferCall tool to initiate the transfer. The system will automatically try each number in order — if the first person is busy or doesn't answer, it will try the next one.`;
      systemPrompt += `\nAlways confirm with the caller before transferring.\n`;

      ultravoxTools.push({
        temporaryTool: {
          modelToolName: "transferCall",
          description: `Transfer the current call to a human agent. The system will automatically try numbers in priority order: ${numbersList}. If the first person is busy, it tries the next. Always confirm with the caller before transferring.`,
          dynamicParameters: [],
          automaticParameters: [
            { name: "call_sid", location: "PARAMETER_LOCATION_BODY", knownValue: "KNOWN_PARAM_CALL_ID" },
          ],
          http: {
            baseUrlPattern: transferUrl,
            httpMethod: "POST",
          },
          staticParameters: [
            { name: "provider", location: "PARAMETER_LOCATION_BODY", value: provider },
            { name: "agent_id", location: "PARAMETER_LOCATION_BODY", value: agent.id },
            { name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey },
          ],
        },
      });
    }

    const aiProvider = (agent as any).ai_provider || "ultravox";
    let streamUrl = "";
    let ultravoxCallId = "";

    if (aiProvider === "gemini") {
      // --- GEMINI LIVE API PATH ---
      const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiApiKey) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, Gemini is not configured. Please try again later.</Say></Response>`,
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }
      streamUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}`.replace("https://", "wss://");
      console.log(`Gemini bridge URL: ${streamUrl}`);
    } else if (aiProvider === "sarvam") {
      // --- SARVAM AI PATH ---
      const sarvamApiKey = Deno.env.get("SARVAM_API_KEY");
      if (!sarvamApiKey) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, Sarvam AI is not configured. Please try again later.</Say></Response>`,
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }
      streamUrl = `${supabaseUrl}/functions/v1/sarvam-voice-bridge?agent_id=${agent.id}&provider=${provider}`.replace("https://", "wss://");
      console.log(`Sarvam bridge URL: ${streamUrl}`);
    } else {
      // --- ULTRAVOX PATH ---
      const medium = provider === "telnyx" ? { telnyx: {} } : { twilio: {} };

      const ultravoxBody: any = {
        systemPrompt,
        model: agent.model || "fixie-ai/ultravox-v0.7",
        voice: agent.voice,
        temperature: Number(agent.temperature),
        firstSpeakerSettings: agent.first_speaker === "FIRST_SPEAKER_AGENT"
          ? { agent: {} }
          : { user: {} },
        medium,
        languageHint: agent.language_hint || "en",
        maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
      };
      if (ultravoxTools.length > 0) {
        ultravoxBody.selectedTools = ultravoxTools;
      }

      const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ultravoxApiKey,
        },
        body: JSON.stringify(ultravoxBody),
      });

      if (!ultravoxResponse.ok) {
        const errorText = await ultravoxResponse.text();
        console.error("Ultravox API error:", errorText);
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, there was a technical issue. Please try again later.</Say></Response>`,
          { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
        );
      }

      const ultravoxData = await ultravoxResponse.json();
      streamUrl = ultravoxData.joinUrl;
      ultravoxCallId = ultravoxData.callId;
      console.log(`Ultravox call created: ${ultravoxCallId}, join URL: ${streamUrl}`);
    }

    // Log the call
    await supabase.from("call_logs").insert({
      user_id: phoneConfig.user_id,
      agent_id: agent.id,
      direction: "inbound",
      caller_number: from,
      recipient_number: to,
      twilio_call_sid: callSid,
      ultravox_call_id: ultravoxCallId || null,
      status: "in-progress",
    });

    // Return TwiML/TeXML to connect to the stream
    // For Gemini: strip query params and pass agent_id via Parameter (Twilio strips query params)
    const isGeminiOrSarvam = aiProvider === "gemini" || aiProvider === "sarvam";
    const cleanStreamUrl = isGeminiOrSarvam ? streamUrl.split('?')[0] : streamUrl;
    const providerParam = aiProvider === "sarvam" ? `<Parameter name="provider" value="${provider}"/>` : "";
    const paramTag = isGeminiOrSarvam ? `<Parameter name="agent_id" value="${agent.id}"/>${providerParam}` : "";

    let responseXml: string;
    if (provider === "telnyx") {
      // Telnyx TeXML requires bidirectional RTP mode and L16 codec per Ultravox docs
      responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${cleanStreamUrl}" bidirectionalMode="rtp" codec="L16" bidirectionalCodec="L16" bidirectionalSamplingRate="16000">${paramTag}</Stream>
  </Connect>
</Response>`;
    } else {
      responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${cleanStreamUrl}">${paramTag}</Stream>
  </Connect>
</Response>`;
    }

    return new Response(responseXml, {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("Error handling inbound call:", error);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Please try again later.</Say></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  }
});
