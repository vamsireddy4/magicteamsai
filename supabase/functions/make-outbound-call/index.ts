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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");

    if (!ultravoxApiKey) {
      return new Response(
        JSON.stringify({ error: "ULTRAVOX_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { agent_id, recipient_number, phone_config_id } = await req.json();

    if (!agent_id || !recipient_number) {
      return new Response(
        JSON.stringify({ error: "agent_id and recipient_number are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch agent (must belong to user)
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agent_id)
      .eq("user_id", user.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch phone config for outbound — prioritize explicit selection, then agent default, then any active
    let phoneConfig;
    if (phone_config_id) {
      const { data } = await supabase
        .from("phone_configs")
        .select("*")
        .eq("id", phone_config_id)
        .eq("user_id", user.id)
        .single();
      phoneConfig = data;
    }

    if (!phoneConfig && agent.phone_number_id) {
      const { data } = await supabase
        .from("phone_configs")
        .select("*")
        .eq("id", agent.phone_number_id)
        .single();
      phoneConfig = data;
    }

    if (!phoneConfig) {
      const { data } = await supabase
        .from("phone_configs")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      phoneConfig = data;
    }

    if (!phoneConfig) {
      return new Response(
        JSON.stringify({ error: "No phone number configured. Add a Twilio or Telnyx number first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const provider = phoneConfig.provider || "twilio";
    const aiProvider = (agent as any).ai_provider || "ultravox";

    let callSid = "";
    let ultravoxCallId = "";

    if (aiProvider === "gemini") {
      // --- GEMINI LIVE API PATH ---
      const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiApiKey) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build WebSocket bridge URL for Gemini (no query params - Twilio strips them)
      const bridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge`.replace("https://", "wss://");

      if (provider === "telnyx") {
        const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
        const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
        if (!telnyxApiKey || !telnyxConnectionId) {
          return new Response(
            JSON.stringify({ error: "Telnyx credentials missing" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Telnyx: pass agent_id in stream_url query params (Telnyx preserves them)
        const telnyxBridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}`.replace("https://", "wss://");
        const telnyxResponse = await fetch("https://api.telnyx.com/v2/calls", {
          method: "POST",
          headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            connection_id: telnyxConnectionId,
            to: recipient_number,
            from: phoneConfig.phone_number,
            stream_url: telnyxBridgeUrl,
            stream_track: "inbound_track",
            stream_bidirectional_mode: "rtp",
            stream_codec: "L16",
            stream_bidirectional_codec: "L16",
            stream_bidirectional_sampling_rate: 16000,
            stream_bidirectional_target_legs: "opposite",
          }),
        });
        if (!telnyxResponse.ok) {
          const err = await telnyxResponse.text();
          return new Response(JSON.stringify({ error: "Telnyx call failed", details: err }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const telnyxData = await telnyxResponse.json();
        callSid = telnyxData.data?.call_control_id || "";
      } else {
        // Twilio: pass agent_id via <Parameter> (Twilio strips query params from Stream URLs)
        const twiml = `<Response><Connect><Stream url="${bridgeUrl}"><Parameter name="agent_id" value="${agent.id}"/></Stream></Connect></Response>`;
        const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
        const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
        const twilioResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ To: recipient_number, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
          }
        );
        if (!twilioResponse.ok) {
          const err = await twilioResponse.text();
          return new Response(JSON.stringify({ error: "Twilio call failed", details: err }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const twilioData = await twilioResponse.json();
        callSid = twilioData.sid;
      }

      console.log(`Gemini call placed via ${provider}: ${callSid}`);

    } else {
      // --- ULTRAVOX PATH (existing) ---
      if (!ultravoxApiKey) {
        return new Response(
          JSON.stringify({ error: "ULTRAVOX_API_KEY not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build Ultravox medium based on telephony provider
      const medium: any = provider === "telnyx"
        ? { telnyx: {} }
        : { twilio: { } };

      const ultravoxBody: any = {
        systemPrompt,
        model: agent.model || "fixie-ai/ultravox-v0.7",
        voice: agent.voice,
        temperature: Number(agent.temperature),
        firstSpeakerSettings: agent.first_speaker === "FIRST_SPEAKER_AGENT" ? { agent: {} } : { user: {} },
        medium,
        languageHint: agent.language_hint || "en",
        maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
      };
      if (ultravoxTools.length > 0) {
        ultravoxBody.selectedTools = ultravoxTools;
      }

      const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": ultravoxApiKey },
        body: JSON.stringify(ultravoxBody),
      });

      if (!ultravoxResponse.ok) {
        const errorText = await ultravoxResponse.text();
        return new Response(
          JSON.stringify({ error: "Failed to create outbound call", details: errorText }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const ultravoxData = await ultravoxResponse.json();
      const joinUrl = ultravoxData.joinUrl;
      ultravoxCallId = ultravoxData.callId;

      console.log(`Ultravox call created: ${ultravoxCallId}, joinUrl: ${joinUrl}`);
      console.log(`Ultravox full response:`, JSON.stringify(ultravoxData));

      if (provider === "telnyx") {
        const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
        const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
        if (!telnyxApiKey || !telnyxConnectionId) {
          return new Response(
            JSON.stringify({ error: "Telnyx credentials missing on this phone config" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const telnyxBody = {
          connection_id: telnyxConnectionId,
          to: recipient_number,
          from: phoneConfig.phone_number,
          stream_url: joinUrl,
          stream_track: "both_tracks",
          stream_bidirectional_mode: "rtp",
          stream_codec: "L16",
          stream_bidirectional_codec: "L16",
          stream_bidirectional_sampling_rate: 16000,
          stream_bidirectional_target_legs: "opposite",
        };
        console.log(`Telnyx call request:`, JSON.stringify(telnyxBody));
        const telnyxResponse = await fetch("https://api.telnyx.com/v2/calls", {
          method: "POST",
          headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(telnyxBody),
        });
        if (!telnyxResponse.ok) {
          const err = await telnyxResponse.text();
          console.error(`Telnyx call failed:`, err);
          return new Response(JSON.stringify({ error: "Failed to place Telnyx call", details: err }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const telnyxData = await telnyxResponse.json();
        console.log(`Telnyx call response:`, JSON.stringify(telnyxData));
        callSid = telnyxData.data?.call_control_id || "";
      } else {
        const twiml = `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`;
        const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
        const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
        const twilioResponse = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`,
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ To: recipient_number, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
          }
        );
        if (!twilioResponse.ok) {
          const err = await twilioResponse.text();
          return new Response(JSON.stringify({ error: "Failed to place Twilio call", details: err }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const twilioData = await twilioResponse.json();
        callSid = twilioData.sid;
      }

      console.log(`${provider} call placed: ${callSid}`);
    }

    // Log the call
    await supabase.from("call_logs").insert({
      user_id: user.id,
      agent_id: agent.id,
      direction: "outbound",
      caller_number: phoneConfig.phone_number,
      recipient_number,
      ultravox_call_id: ultravoxCallId || null,
      twilio_call_sid: callSid,
      status: "initiated",
    });

    return new Response(
      JSON.stringify({ success: true, callId: ultravoxCallId || callSid, callSid }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error making outbound call:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
