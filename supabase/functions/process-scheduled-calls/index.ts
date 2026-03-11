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
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find all pending scheduled calls where scheduled_at <= now
    const { data: pendingCalls, error: fetchError } = await supabase
      .from("scheduled_calls")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at");

    if (fetchError) {
      console.error("Error fetching scheduled calls:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pendingCalls || pendingCalls.length === 0) {
      return new Response(JSON.stringify({ message: "No pending calls to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing ${pendingCalls.length} scheduled calls`);
    const results: any[] = [];

    for (const sc of pendingCalls) {
      try {
        // Mark as in_progress
        await supabase.from("scheduled_calls").update({ status: "in_progress" }).eq("id", sc.id);

        if (!sc.agent_id) {
          await supabase.from("scheduled_calls").update({ status: "failed" }).eq("id", sc.id);
          results.push({ id: sc.id, status: "failed", error: "No agent assigned" });
          continue;
        }

        // Fetch agent
        const { data: agent } = await supabase.from("agents").select("*").eq("id", sc.agent_id).single();
        if (!agent) {
          await supabase.from("scheduled_calls").update({ status: "failed" }).eq("id", sc.id);
          results.push({ id: sc.id, status: "failed", error: "Agent not found" });
          continue;
        }

        // Fetch phone config: agent's default or any active for user
        let phoneConfig: any = null;
        if (agent.phone_number_id) {
          const { data } = await supabase.from("phone_configs").select("*").eq("id", agent.phone_number_id).single();
          phoneConfig = data;
        }
        if (!phoneConfig) {
          const { data } = await supabase.from("phone_configs").select("*").eq("user_id", sc.user_id).eq("is_active", true).limit(1).single();
          phoneConfig = data;
        }

        if (!phoneConfig) {
          await supabase.from("scheduled_calls").update({ status: "failed" }).eq("id", sc.id);
          results.push({ id: sc.id, status: "failed", error: "No phone config" });
          continue;
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
            if (item.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
            if (item.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
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
        const aiProvider = agent.ai_provider || "ultravox";
        let callSid = "";
        let ultravoxCallId = "";

        if (aiProvider === "gemini") {
          if (!geminiApiKey) throw new Error("GEMINI_API_KEY not configured");
          const bridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}`.replace("https://", "wss://");

          if (provider === "telnyx") {
            const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
            const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
            const resp = await fetch("https://api.telnyx.com/v2/calls", {
              method: "POST",
              headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                connection_id: telnyxConnectionId, to: sc.recipient_number, from: phoneConfig.phone_number,
                stream_url: bridgeUrl, stream_track: "both_tracks",
              }),
            });
            if (!resp.ok) throw new Error(`Telnyx: ${await resp.text()}`);
            callSid = (await resp.json()).data?.call_control_id || "";
          } else {
            const twiml = `<Response><Connect><Stream url="${bridgeUrl.split('?')[0]}"><Parameter name="agent_id" value="${agent.id}"/></Stream></Connect></Response>`;
            const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
            const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
            const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
              method: "POST",
              headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ To: sc.recipient_number, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
            });
            if (!resp.ok) throw new Error(`Twilio: ${await resp.text()}`);
            callSid = (await resp.json()).sid;
          }
        } else {
          // Ultravox path
          if (!ultravoxApiKey) throw new Error("ULTRAVOX_API_KEY not configured");
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
          if (!ultravoxResponse.ok) throw new Error(`Ultravox: ${await ultravoxResponse.text()}`);
          const ultravoxData = await ultravoxResponse.json();
          const joinUrl = ultravoxData.joinUrl;
          ultravoxCallId = ultravoxData.callId;

          if (provider === "telnyx") {
            const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
            const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
            const resp = await fetch("https://api.telnyx.com/v2/calls", {
              method: "POST",
              headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                connection_id: telnyxConnectionId, to: sc.recipient_number, from: phoneConfig.phone_number,
                stream_url: joinUrl, stream_track: "both_tracks",
              }),
            });
            if (!resp.ok) throw new Error(`Telnyx: ${await resp.text()}`);
            callSid = (await resp.json()).data?.call_control_id || "";
          } else {
            const twiml = `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`;
            const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
            const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
            const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
              method: "POST",
              headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ To: sc.recipient_number, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
            });
            if (!resp.ok) throw new Error(`Twilio: ${await resp.text()}`);
            callSid = (await resp.json()).sid;
          }
        }

        // Log the call
        await supabase.from("call_logs").insert({
          user_id: sc.user_id, agent_id: agent.id, direction: "outbound",
          caller_number: phoneConfig.phone_number, recipient_number: sc.recipient_number,
          ultravox_call_id: ultravoxCallId || null, twilio_call_sid: callSid, status: "initiated",
        });

        // Mark scheduled call as completed
        await supabase.from("scheduled_calls").update({ status: "completed" }).eq("id", sc.id);
        results.push({ id: sc.id, status: "completed", ultravoxCallId });
      } catch (err: any) {
        console.error(`Failed scheduled call ${sc.id}:`, err.message);
        await supabase.from("scheduled_calls").update({ status: "failed" }).eq("id", sc.id);
        results.push({ id: sc.id, status: "failed", error: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error processing scheduled calls:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
