import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function placeCall(
  supabase: any,
  ultravoxApiKey: string,
  agent: any,
  phoneConfig: any,
  recipientNumber: string,
  userId: string,
  kbItems: any[],
  agentTools: any[]
) {
  let systemPrompt = agent.system_prompt;
  if (kbItems && kbItems.length > 0) {
    systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
    for (const item of kbItems) {
      if (item.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
      if (item.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
    }
  }

  // Build Ultravox tools from agent_tools
  const ultravoxTools: any[] = [];
  if (agentTools && agentTools.length > 0) {
    for (const tool of agentTools) {
      const params: Record<string, any> = {};
      const required: string[] = [];
      if (Array.isArray(tool.parameters)) {
        for (const p of tool.parameters as any[]) {
          params[p.name] = { type: p.type || "string", description: p.description || "" };
          if (p.required) required.push(p.name);
        }
      }
      ultravoxTools.push({
        temporaryTool: {
          modelToolName: tool.name,
          description: tool.description,
          dynamicParameters: [{
            name: "args",
            location: "PARAMETER_LOCATION_BODY",
            schema: { type: "object", properties: params, required },
            required: true,
          }],
          http: {
            baseUrlPattern: tool.http_url,
            httpMethod: tool.http_method,
          },
        },
      });
    }
  }

  const provider = phoneConfig.provider || "twilio";
  const aiProvider = agent.ai_provider || "ultravox";
  let callSid = "";
  let ultravoxCallId = "";

  if (aiProvider === "gemini") {
    // Gemini Live API path
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const bridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}`.replace("https://", "wss://");

    if (provider === "telnyx") {
      const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
      const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
      if (!telnyxApiKey || !telnyxConnectionId) throw new Error("Telnyx credentials missing");
      const resp = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: telnyxConnectionId, to: recipientNumber, from: phoneConfig.phone_number,
          stream_url: bridgeUrl, stream_track: "both_tracks",
        }),
      });
      if (!resp.ok) throw new Error(`Telnyx error: ${await resp.text()}`);
      callSid = (await resp.json()).data?.call_control_id || "";
    } else {
      const twiml = `<Response><Connect><Stream url="${bridgeUrl.split('?')[0]}"><Parameter name="agent_id" value="${agent.id}"/></Stream></Connect></Response>`;
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: recipientNumber, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
      });
      if (!resp.ok) throw new Error(`Twilio error: ${await resp.text()}`);
      callSid = (await resp.json()).sid;
    }
  } else {
    // Ultravox path
    const medium = provider === "telnyx" ? { telnyx: {} } : { twilio: {} };
    const ultravoxBody: any = {
      systemPrompt, model: agent.model || "fixie-ai/ultravox-v0.7", voice: agent.voice,
      temperature: Number(agent.temperature), firstSpeakerSettings: { user: {} }, medium,
      languageHint: agent.language_hint || "en", maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
    };
    if (ultravoxTools.length > 0) {
      ultravoxBody.selectedTools = ultravoxTools;
    }
    const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": ultravoxApiKey },
      body: JSON.stringify(ultravoxBody),
    });
    if (!ultravoxResponse.ok) throw new Error(`Ultravox error: ${await ultravoxResponse.text()}`);
    const ultravoxData = await ultravoxResponse.json();
    const joinUrl = ultravoxData.joinUrl;
    ultravoxCallId = ultravoxData.callId;

    if (provider === "telnyx") {
      const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
      const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
      if (!telnyxApiKey || !telnyxConnectionId) throw new Error("Telnyx credentials missing");
      const resp = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: telnyxConnectionId, to: recipientNumber, from: phoneConfig.phone_number,
          stream_url: joinUrl, stream_track: "both_tracks",
        }),
      });
      if (!resp.ok) throw new Error(`Telnyx error: ${await resp.text()}`);
      callSid = (await resp.json()).data?.call_control_id || "";
    } else {
      const twiml = `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`;
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: recipientNumber, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
      });
      if (!resp.ok) throw new Error(`Twilio error: ${await resp.text()}`);
      callSid = (await resp.json()).sid;
    }
  }

  await supabase.from("call_logs").insert({
    user_id: userId, agent_id: agent.id, direction: "outbound",
    caller_number: phoneConfig.phone_number, recipient_number: recipientNumber,
    ultravox_call_id: ultravoxCallId || null, twilio_call_sid: callSid, status: "initiated",
  });

  return { ultravoxCallId, callSid };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaign_id } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch campaign
    const { data: campaign, error: campError } = await supabase
      .from("campaigns").select("*").eq("id", campaign_id).eq("user_id", user.id).single();
    if (campError || !campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!campaign.agent_id || !campaign.phone_config_id) {
      return new Response(JSON.stringify({ error: "Campaign must have an agent and phone config assigned" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch agent
    const { data: agent } = await supabase.from("agents").select("*").eq("id", campaign.agent_id).single();
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch phone config
    const { data: phoneConfig } = await supabase.from("phone_configs").select("*").eq("id", campaign.phone_config_id).single();
    if (!phoneConfig) {
      return new Response(JSON.stringify({ error: "Phone config not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch contacts for this campaign
    const { data: contacts } = await supabase
      .from("contacts").select("*").eq("campaign_id", campaign_id).order("created_at");
    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ error: "No contacts found for this campaign" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch DNC list
    const { data: dncList } = await supabase.from("do_not_call").select("phone_number").eq("user_id", user.id);
    const dncNumbers = new Set((dncList || []).map((d: any) => d.phone_number));

    // Fetch knowledge base and agent tools in parallel
    const [{ data: kbItems }, { data: agentTools }] = await Promise.all([
      supabase.from("knowledge_base_items").select("*").eq("agent_id", agent.id),
      supabase.from("agent_tools").select("*").eq("agent_id", agent.id).eq("is_active", true),
    ]);

    // Filter out DNC numbers
    const eligibleContacts = contacts.filter((c: any) => !dncNumbers.has(c.phone_number));

    // Update campaign status
    await supabase.from("campaigns").update({
      status: "active",
      total_contacts: eligibleContacts.length,
      calls_made: 0,
    }).eq("id", campaign_id);

    const delayMs = (campaign.delay_seconds || 30) * 1000;
    const results: any[] = [];

    for (let i = 0; i < eligibleContacts.length; i++) {
      const contact = eligibleContacts[i];
      try {
        const result = await placeCall(supabase, ultravoxApiKey, agent, phoneConfig, contact.phone_number, user.id, kbItems || []);
        results.push({ phone: contact.phone_number, status: "initiated", ...result });
      } catch (err: any) {
        console.error(`Failed to call ${contact.phone_number}:`, err.message);
        results.push({ phone: contact.phone_number, status: "failed", error: err.message });
      }

      // Update progress
      await supabase.from("campaigns").update({ calls_made: i + 1 }).eq("id", campaign_id);

      // Delay between calls (except after the last one)
      if (i < eligibleContacts.length - 1) {
        await sleep(delayMs);
      }
    }

    // Mark campaign completed
    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign_id);

    return new Response(JSON.stringify({ success: true, total: eligibleContacts.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error running campaign:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
