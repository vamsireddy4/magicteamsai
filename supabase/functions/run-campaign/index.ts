import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

async function placeCall(
  supabase: any,
  ultravoxApiKey: string | undefined,
  agent: any,
  phoneConfig: any,
  recipientNumber: string,
  userId: string,
  kbItems: any[],
  agentTools: any[]
) {
  const normalizePhoneNumber = (raw: string, fromNumber?: string | null) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith("+")) return trimmed;
    if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return trimmed;
    if (digits.length >= 11) return `+${digits}`;

    const fromDigits = String(fromNumber || "").replace(/\D/g, "");
    if (digits.length === 10 && fromDigits.length >= 11) {
      const countryCode = fromDigits.slice(0, fromDigits.length - 10);
      if (countryCode) {
        return `+${countryCode}${digits}`;
      }
    }

    return trimmed;
  };

  const normalizedRecipientNumber = normalizePhoneNumber(recipientNumber, phoneConfig.phone_number);
  let systemPrompt = agent.system_prompt;
  if (kbItems && kbItems.length > 0) {
    systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
    for (const item of kbItems) {
      if (item.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
      else if (item.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
    }
  }

  // ── Tool-building helpers ─────────────────────────────────────────────────
  const KNOWN_VALUE_MAP: Record<string, string> = {
    "call.id": "KNOWN_PARAM_CALL_ID",
    "call.stage_id": "KNOWN_PARAM_CALL_STAGE_ID",
    "call.state": "KNOWN_PARAM_CALL_STATE",
    "call.conversation_history": "KNOWN_PARAM_CONVERSATION_HISTORY",
    "call.sample_rate": "KNOWN_PARAM_CALL_SAMPLE_RATE",
  };
  const END_BEHAVIOR_MAP: Record<string, string> = {
    "Speaks": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS",
    "Listens": "AGENT_TEXT_BEHAVIOR_AGENT_LISTENS",
    "Speaks Once": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS_ONCE",
  };
  const locationToUltravox = (loc: string) => {
    if (loc === "header") return "PARAMETER_LOCATION_HEADER";
    if (loc === "query") return "PARAMETER_LOCATION_QUERY";
    return "PARAMETER_LOCATION_BODY";
  };

  // Build Ultravox selectedTools from agent_tools (custom HTTP tools)
  const ultravoxTools: any[] = [];
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
          if (headerName && headerValue) staticParameters.push({ name: headerName, location: "PARAMETER_LOCATION_HEADER", value: headerValue });
        }
      }
      if (tool.http_body_template && typeof tool.http_body_template === "object") {
        for (const [key, value] of Object.entries(tool.http_body_template as Record<string, any>)) {
          if (!key.startsWith("__") && key) staticParameters.push({ name: key, location: "PARAMETER_LOCATION_BODY", value: String(value) });
        }
      }
      const temporaryTool: any = {
        modelToolName: tool.name,
        description: tool.description,
        dynamicParameters,
        http: { baseUrlPattern: tool.http_url, httpMethod: tool.http_method },
      };
      if (staticParameters.length > 0) temporaryTool.staticParameters = staticParameters;
      if (automaticParameters.length > 0) temporaryTool.automaticParameters = automaticParameters;
      const bodyMeta = (tool.http_body_template as Record<string, any>) || {};
      if (bodyMeta.__agentEndBehavior && END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior]) temporaryTool.defaultReaction = END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior];
      if (bodyMeta.__staticResponse) temporaryTool.staticResponse = bodyMeta.__staticResponse;
      ultravoxTools.push({ temporaryTool });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const provider = phoneConfig.provider || "twilio";

  // Appointment tools (calendar availability + booking)
  const { data: appointmentTools } = await supabase
    .from("appointment_tools").select("*, calendar_integrations(*)").eq("agent_id", agent.id).eq("is_active", true);
  if (appointmentTools && appointmentTools.length > 0) {
    const checkAvailabilityUrl = `${supabaseUrl}/functions/v1/check-calendar-availability`;
    const bookAppointmentUrl = `${supabaseUrl}/functions/v1/book-calendar-appointment`;
    for (const apptTool of appointmentTools) {
      const integration = (apptTool as any).calendar_integrations;
      if (!integration) continue;
      const enabledDays = Object.entries(apptTool.business_hours as Record<string, any>)
        .filter(([_, v]: any) => v.enabled).map(([day, v]: any) => `${day}: ${v.start}-${v.end}`).join(", ");
      const typesList = (apptTool.appointment_types as any[]).map((t: any) => `${t.name} (${t.duration}min)`).join(", ");
      systemPrompt += `\n\n--- APPOINTMENT TOOL: ${apptTool.name} ---\nProvider: ${apptTool.provider}\nBusiness Hours: ${enabledDays}\nAppointment Types: ${typesList}\nUse check_availability_${apptTool.name.replace(/[^a-zA-Z0-9]/g, '_')} to check calendar availability.\nUse book_appointment_${apptTool.name.replace(/[^a-zA-Z0-9]/g, '_')} to book an appointment.\n`;
      const toolNameSuffix = apptTool.name.replace(/[^a-zA-Z0-9]/g, '_');
      const authHeaders = [{ name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey }];
      ultravoxTools.push({ temporaryTool: { modelToolName: `check_availability_${toolNameSuffix}`, description: `Check calendar availability for ${apptTool.name}. Returns available time slots for a given date.`, dynamicParameters: [{ name: "date", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Date to check availability (YYYY-MM-DD format)" }, required: true }, { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Desired meeting duration in minutes" }, required: false }], http: { baseUrlPattern: checkAvailabilityUrl, httpMethod: "POST" }, staticParameters: [{ name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider }, { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id }, ...authHeaders] } });
      ultravoxTools.push({ temporaryTool: { modelToolName: `book_appointment_${toolNameSuffix}`, description: `Book an appointment using ${apptTool.name}. Schedule a meeting at a specific date and time.`, dynamicParameters: [{ name: "start_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Start time in ISO 8601 format" }, required: true }, { name: "end_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "End time in ISO 8601 format. Optional if duration_minutes is provided" }, required: false }, { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Duration in minutes if end_time is omitted" }, required: false }, { name: "attendee_name", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Name of the person booking" }, required: true }, { name: "attendee_email", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Email of the person booking" }, required: false }, { name: "attendee_phone", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Phone number of the person booking" }, required: false }, { name: "notes", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Additional notes" }, required: false }], http: { baseUrlPattern: bookAppointmentUrl, httpMethod: "POST" }, staticParameters: [{ name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider }, { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id }, ...authHeaders] } });
    }
  }

  // Call forwarding / transfer tool — DO NOT change this block (working in production)
  const { data: forwardingNumbers } = await supabase
    .from("call_forwarding_numbers").select("*").eq("agent_id", agent.id).order("priority", { ascending: true });
  if (forwardingNumbers && forwardingNumbers.length > 0) {
    const transferUrl = `${supabaseUrl}/functions/v1/transfer-call`;
    const numbersList = forwardingNumbers.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
    systemPrompt += `\n\n--- CALL FORWARDING ---\nYou can transfer the caller to a human agent if they request it or if you cannot help them.\nAvailable transfer destinations (in priority order): ${numbersList}\nUse the transferCall tool to initiate the transfer. The system will automatically try each number in order — if the first person is busy or doesn't answer, it will try the next one.\nAlways confirm with the caller before transferring.\n`;
    ultravoxTools.push({
      temporaryTool: {
        modelToolName: "transferCall",
        description: `Transfer the current call to a human agent. The system will automatically try numbers in priority order: ${numbersList}. If the first person is busy, it tries the next. Always confirm with the caller before transferring.`,
        dynamicParameters: [],
        automaticParameters: [
          { name: "call_sid", location: "PARAMETER_LOCATION_BODY", knownValue: "KNOWN_PARAM_CALL_ID" },
        ],
        http: { baseUrlPattern: transferUrl, httpMethod: "POST" },
        staticParameters: [
          { name: "provider", location: "PARAMETER_LOCATION_BODY", value: provider },
          { name: "agent_id", location: "PARAMETER_LOCATION_BODY", value: agent.id },
          { name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey },
        ],
      },
    });
  }

  const aiProvider = agent.ai_provider || "ultravox";
  let callSid = "";
  let ultravoxCallId = "";

  if (aiProvider === "gemini") {
    // Gemini Live API path
    const bridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}`.replace("https://", "wss://");

    if (provider === "telnyx") {
      const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
      const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
      if (!telnyxApiKey || !telnyxConnectionId) throw new Error("Telnyx credentials missing");
      const webhookUrl = `${supabaseUrl}/functions/v1/handle-telnyx-webhook`;
      const resp = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: telnyxConnectionId, to: normalizedRecipientNumber, from: phoneConfig.phone_number,
          webhook_url: webhookUrl, timeout_secs: 90,
        }),
      });
      if (!resp.ok) throw new Error(`Telnyx error: ${await resp.text()}`);
      callSid = (await resp.json()).data?.call_control_id || "";
      await supabase.from("telnyx_call_state").insert({
        call_control_id: callSid, join_url: bridgeUrl,
        telnyx_api_key: telnyxApiKey, agent_id: agent.id, user_id: userId,
      });
    } else {
      const twiml = `<Response><Connect><Stream url="${bridgeUrl.split('?')[0]}"><Parameter name="agent_id" value="${agent.id}"/></Stream></Connect></Response>`;
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: normalizedRecipientNumber, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
      });
      if (!resp.ok) throw new Error(`Twilio error: ${await resp.text()}`);
      callSid = (await resp.json()).sid;
    }
  } else if (aiProvider === "sarvam") {
    // Sarvam AI path
    const bridgeUrl = `${supabaseUrl}/functions/v1/sarvam-voice-bridge?agent_id=${agent.id}&provider=${provider}`.replace("https://", "wss://");

    if (provider === "telnyx") {
      const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
      const telnyxConnectionId = (phoneConfig.telnyx_connection_id || "").trim();
      if (!telnyxApiKey || !telnyxConnectionId) throw new Error("Telnyx credentials missing");
      const webhookUrl = `${supabaseUrl}/functions/v1/handle-telnyx-webhook`;
      const resp = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: telnyxConnectionId, to: normalizedRecipientNumber, from: phoneConfig.phone_number,
          webhook_url: webhookUrl, timeout_secs: 90,
        }),
      });
      if (!resp.ok) throw new Error(`Telnyx error: ${await resp.text()}`);
      callSid = (await resp.json()).data?.call_control_id || "";
      await supabase.from("telnyx_call_state").insert({
        call_control_id: callSid, join_url: bridgeUrl,
        telnyx_api_key: telnyxApiKey, agent_id: agent.id, user_id: userId,
      });
    } else {
      const twiml = `<Response><Connect><Stream url="${bridgeUrl.split('?')[0]}"><Parameter name="agent_id" value="${agent.id}"/><Parameter name="provider" value="twilio"/></Stream></Connect></Response>`;
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: normalizedRecipientNumber, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
      });
      if (!resp.ok) throw new Error(`Twilio error: ${await resp.text()}`);
      callSid = (await resp.json()).sid;
    }
  } else {
    // Ultravox path
    if (!ultravoxApiKey) throw new Error("ULTRAVOX_API_KEY not configured");
    let modelName = agent.model || "fixie-ai/ultravox-v0.7";
    if (modelName && !modelName.includes("/")) {
      modelName = `fixie-ai/${modelName}`;
    }
    const medium = provider === "telnyx" ? { telnyx: {} } : { twilio: {} };
    const ultravoxBody: any = {
      systemPrompt, model: modelName, voice: agent.voice,
      temperature: Number(agent.temperature), firstSpeakerSettings: { user: {} }, medium,
      languageHint: normalizeUltravoxLanguageHint(agent.language_hint || "en"), maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
    };
    if (ultravoxTools.length > 0) {
      ultravoxBody.selectedTools = ultravoxTools;
    }
    console.log(`[run-campaign] Ultravox call: model=${modelName}, voice=${agent.voice}, provider=${provider}`);
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
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookUrl = `${supabaseUrl}/functions/v1/handle-telnyx-webhook`;
      const resp = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { "Authorization": `Bearer ${telnyxApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: telnyxConnectionId, to: normalizedRecipientNumber, from: phoneConfig.phone_number,
          webhook_url: webhookUrl, timeout_secs: 90,
        }),
      });
      if (!resp.ok) throw new Error(`Telnyx error: ${await resp.text()}`);
      callSid = (await resp.json()).data?.call_control_id || "";
      await supabase.from("telnyx_call_state").insert({
        call_control_id: callSid, join_url: joinUrl,
        telnyx_api_key: telnyxApiKey, agent_id: agent.id, user_id: userId,
      });
    } else {
      const twiml = `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`;
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, '');
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, '');
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: normalizedRecipientNumber, From: phoneConfig.phone_number, Twiml: twiml }).toString(),
      });
      if (!resp.ok) throw new Error(`Twilio error: ${await resp.text()}`);
      callSid = (await resp.json()).sid;
    }
  }

  await supabase.from("call_logs").insert({
    user_id: userId, agent_id: agent.id, direction: "outbound",
    caller_number: phoneConfig.phone_number, recipient_number: normalizedRecipientNumber,
    ultravox_call_id: ultravoxCallId || null, twilio_call_sid: callSid, status: "initiated",
  });

  return { ultravoxCallId, callSid };
}

async function createOutcome(
  supabase: any,
  userId: string,
  campaignId: string,
  contact: any,
  status: string,
  attemptNumber: number
) {
  const { data: existing } = await supabase
    .from("call_outcomes")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("contact_id", contact.id || null)
    .eq("attempt_number", attemptNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    user_id: userId,
    campaign_id: campaignId,
    phone_number: contact.phone_number,
    parent_name: contact.first_name || null,
    child_names: contact.child_names || null,
    venue_name: contact.venue_name || null,
    contact_id: contact.id || null,
    outcome: status,
    attempt_number: attemptNumber,
  };

  if (existing?.id) {
    await supabase.from("call_outcomes").update(payload).eq("id", existing.id);
    return;
  }

  await supabase.from("call_outcomes").insert(payload);
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

    const { campaign_id, contact_ids } = await req.json();
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

    // Fetch contacts for this campaign — optionally filtered by selected IDs
    let contactsQuery = supabase.from("contacts").select("*").eq("campaign_id", campaign_id).order("created_at");
    if (contact_ids && Array.isArray(contact_ids) && contact_ids.length > 0) {
      contactsQuery = contactsQuery.in("id", contact_ids);
    }
    const { data: contacts } = await contactsQuery;
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
        const result = await placeCall(supabase, ultravoxApiKey, agent, phoneConfig, contact.phone_number, user.id, kbItems || [], agentTools || []);
        results.push({ phone: contact.phone_number, status: "initiated", ...result });
        // Create a PENDING outcome for this call
        await createOutcome(supabase, user.id, campaign_id, contact, "PENDING", campaign.round || 1);
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
