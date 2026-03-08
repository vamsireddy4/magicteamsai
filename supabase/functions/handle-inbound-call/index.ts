import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // This endpoint is called by Twilio when an inbound call arrives
    // Twilio sends form-encoded data
    const contentType = req.headers.get("content-type") || "";
    let callSid = "";
    let from = "";
    let to = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      callSid = formData.get("CallSid") as string || "";
      from = formData.get("From") as string || "";
      to = formData.get("To") as string || "";
    } else {
      const body = await req.json();
      callSid = body.CallSid || "";
      from = body.From || "";
      to = body.To || "";
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

    // Find the agent associated with this phone number
    const { data: phoneConfig } = await supabase
      .from("phone_configs")
      .select("*, agents!agents_phone_number_id_fkey(*)")
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

    // Fetch knowledge base for this agent
    const { data: kbItems } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("agent_id", agent.id);

    // Build system prompt with knowledge base
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

    // Create Ultravox call
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
        firstSpeaker: agent.first_speaker === "FIRST_SPEAKER_AGENT" ? "FIRST_SPEAKER_AGENT" : "FIRST_SPEAKER_USER",
        medium: {
          twilio: {},
        },
        languageHint: agent.language_hint || "en",
        maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
      }),
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
    const joinUrl = ultravoxData.joinUrl;
    const ultravoxCallId = ultravoxData.callId;

    console.log(`Ultravox call created: ${ultravoxCallId}, join URL: ${joinUrl}`);

    // Log the call
    await supabase.from("call_logs").insert({
      user_id: phoneConfig.user_id,
      agent_id: agent.id,
      direction: "inbound",
      caller_number: from,
      recipient_number: to,
      twilio_call_sid: callSid,
      ultravox_call_id: ultravoxCallId,
      status: "in-progress",
    });

    // Return TwiML to connect Twilio to the Ultravox WebSocket
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${joinUrl}" />
  </Connect>
</Response>`;

    return new Response(twiml, {
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
