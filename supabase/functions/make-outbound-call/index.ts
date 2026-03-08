import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const { agent_id, recipient_number } = await req.json();

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

    // Fetch phone config for outbound (use agent's linked phone or first available)
    let phoneConfig;
    if (agent.phone_number_id) {
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
        JSON.stringify({ error: "No phone number configured. Add a Twilio number first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch knowledge base
    const { data: kbItems } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("agent_id", agent.id);

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

    // Create Ultravox outbound call
    const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ultravoxApiKey,
      },
      body: JSON.stringify({
        systemPrompt,
        model: "fixie-ai/ultravox-70B",
        voice: agent.voice,
        temperature: Number(agent.temperature),
        firstSpeaker: "FIRST_SPEAKER_USER",
        medium: {
          twilio: {
            accountSid: phoneConfig.twilio_account_sid,
            authToken: phoneConfig.twilio_auth_token,
          },
        },
        languageHint: agent.language_hint || "en",
        maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
        // For outbound, Ultravox handles calling via Twilio
        initiator: "INITIATOR_AGENT",
        medium_twilio_to: recipient_number,
        medium_twilio_from: phoneConfig.phone_number,
      }),
    });

    if (!ultravoxResponse.ok) {
      const errorText = await ultravoxResponse.text();
      console.error("Ultravox API error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to create outbound call", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ultravoxData = await ultravoxResponse.json();

    // Log the call
    await supabase.from("call_logs").insert({
      user_id: user.id,
      agent_id: agent.id,
      direction: "outbound",
      caller_number: phoneConfig.phone_number,
      recipient_number,
      ultravox_call_id: ultravoxData.callId,
      status: "initiated",
    });

    return new Response(
      JSON.stringify({ success: true, callId: ultravoxData.callId }),
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
