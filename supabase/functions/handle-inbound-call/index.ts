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

    // Fetch knowledge base and agent tools in parallel
    const [{ data: kbItems }, { data: agentTools }] = await Promise.all([
      supabase.from("knowledge_base_items").select("*").eq("agent_id", agent.id),
      supabase.from("agent_tools").select("*").eq("agent_id", agent.id).eq("is_active", true),
    ]);

    let systemPrompt = agent.system_prompt;
    if (kbItems && kbItems.length > 0) {
      systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
      for (const item of kbItems) {
        if (item.content) {
          systemPrompt += `\n## ${item.title}\n${item.content}\n`;
        }
        if (item.website_url) {
          systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
        }
      }
    }

    // Build Ultravox tools from agent_tools
    const ultravoxTools: any[] = [];
    if (agentTools && agentTools.length > 0) {
      for (const tool of agentTools) {
        const dynamicParameters: any[] = [];
        if (Array.isArray(tool.parameters)) {
          for (const p of tool.parameters as any[]) {
            dynamicParameters.push({
              name: p.name,
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: p.type || "string", description: p.description || "" },
              required: !!p.required,
            });
          }
        }
        ultravoxTools.push({
          temporaryTool: {
            modelToolName: tool.name,
            description: tool.description,
            dynamicParameters,
            http: {
              baseUrlPattern: tool.http_url,
              httpMethod: tool.http_method,
            },
          },
        });
      }
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
    const isGemini = (agent as any).ai_provider === "gemini";
    const cleanStreamUrl = isGemini ? streamUrl.split('?')[0] : streamUrl;
    const paramTag = isGemini ? `<Parameter name="agent_id" value="${agent.id}"/>` : "";

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
