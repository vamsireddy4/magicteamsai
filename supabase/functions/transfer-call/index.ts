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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const contentType = req.headers.get("content-type") || "";
    const url = new URL(req.url);

    // Check if this is a Twilio action callback (form-encoded) for sequential fallback
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return await handleTwilioCallback(req, url, supabase, supabaseUrl);
    }

    // Normal JSON request from Ultravox tool
    const { call_sid, agent_id, provider } = await req.json();

    if (!call_sid) {
      return new Response(
        JSON.stringify({ error: "call_sid is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Transfer call ${call_sid} via ${provider}, agent_id: ${agent_id}`);

    // Find the call log to get phone config details
    let callLog: any = null;
    
    // Primary lookup by call_sid
    if (call_sid) {
      const { data } = await supabase
        .from("call_logs")
        .select("*, agents(phone_number_id)")
        .or(`twilio_call_sid.eq.${call_sid},ultravox_call_id.eq.${call_sid}`)
        .limit(1)
        .single();
      callLog = data;
    }

    // Fallback: lookup by agent_id for active calls
    if (!callLog && agent_id) {
      console.log(`[TRANSFER] Primary lookup failed, trying agent_id fallback: ${agent_id}`);
      const { data } = await supabase
        .from("call_logs")
        .select("*, agents(phone_number_id)")
        .eq("agent_id", agent_id)
        .in("status", ["initiated", "in-progress"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      callLog = data;
    }

    if (!callLog) {
      return new Response(
        JSON.stringify({ error: "Call not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get phone config for credentials
    const phoneConfig = await getPhoneConfig(supabase, callLog);
    if (!phoneConfig) {
      return new Response(
        JSON.stringify({ error: "Phone config not found for this call" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get forwarding numbers ordered by priority
    const resolvedAgentId = agent_id || callLog.agent_id;
    const { data: forwardingNumbers } = await supabase
      .from("call_forwarding_numbers")
      .select("*")
      .eq("agent_id", resolvedAgentId)
      .order("priority", { ascending: true });

    if (!forwardingNumbers || forwardingNumbers.length === 0) {
      return new Response(
        JSON.stringify({ error: "No forwarding numbers configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callProvider = provider || phoneConfig.provider || "twilio";
    const firstNumber = forwardingNumbers[0].phone_number;

    if (callProvider === "telnyx") {
      // Telnyx: use the actual call_control_id from callLog, not the Ultravox call ID
      const actualTelnyxId = callLog.twilio_call_sid || call_sid;
      return await handleTelnyxTransfer(phoneConfig, actualTelnyxId, forwardingNumbers, supabase);
    } else {
      // Twilio: use <Dial action="callback"> for sequential fallback
      const actualCallSid = callLog.twilio_call_sid || call_sid;
      return await initiateTwilioSequentialDial(
        phoneConfig, actualCallSid, forwardingNumbers, 0, supabaseUrl, resolvedAgentId
      );
    }
  } catch (error: any) {
    console.error("Transfer call error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getPhoneConfig(supabase: any, callLog: any) {
  const phoneNumberId = callLog.agents?.phone_number_id;
  if (phoneNumberId) {
    const { data } = await supabase
      .from("phone_configs")
      .select("*")
      .eq("id", phoneNumberId)
      .single();
    if (data) return data;
  }

  // Fallback: find by the caller/recipient number
  const number = callLog.direction === "inbound" ? callLog.recipient_number : callLog.caller_number;
  if (number) {
    const { data } = await supabase
      .from("phone_configs")
      .select("*")
      .eq("phone_number", number)
      .limit(1)
      .single();
    return data;
  }
  return null;
}

async function initiateTwilioSequentialDial(
  phoneConfig: any,
  callSid: string,
  forwardingNumbers: any[],
  attempt: number,
  supabaseUrl: string,
  agentId: string
) {
  const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, "");
  const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, "");

  if (!twilioAccountSid || !twilioAuthToken) {
    return new Response(
      JSON.stringify({ error: "Twilio credentials not configured" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const destination = forwardingNumbers[attempt].phone_number;
  const label = forwardingNumbers[attempt].label || `Person ${attempt + 1}`;
  const hasNext = attempt + 1 < forwardingNumbers.length;

  console.log(`Twilio sequential dial: attempt ${attempt + 1}/${forwardingNumbers.length}, dialing ${destination} (${label})`);

  // Build TwiML with action callback for fallback
  let twiml: string;
  if (hasNext) {
    // If this dial fails, Twilio will POST to the action URL to try the next number
    const actionUrl = `${supabaseUrl}/functions/v1/transfer-call?attempt=${attempt + 1}&agent_id=${agentId}&phone_config_id=${phoneConfig.id}`;
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial action="${actionUrl}" timeout="30">${destination}</Dial></Response>`;
  } else {
    // Last number - no fallback, just say sorry if it fails
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="30">${destination}</Dial><Say>Sorry, no one is available to take your call right now. Please try again later.</Say></Response>`;
  }

  const updateResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls/${callSid}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Twiml: twiml }).toString(),
    }
  );

  if (!updateResponse.ok) {
    const err = await updateResponse.text();
    console.error("Twilio transfer error:", err);
    return new Response(
      JSON.stringify({ error: "Transfer failed", details: err }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, message: `Transferring call to ${destination} (${label}). ${hasNext ? `Will try ${forwardingNumbers.length - attempt - 1} more number(s) if busy.` : "This is the last number in the chain."}` }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Handle Twilio action callback when a dial attempt completes (busy/no-answer/failed)
async function handleTwilioCallback(req: Request, url: URL, supabase: any, supabaseUrl: string) {
  const formData = await req.formData();
  const dialCallStatus = (formData.get("DialCallStatus") as string) || "";
  const attempt = parseInt(url.searchParams.get("attempt") || "0", 10);
  const agentId = url.searchParams.get("agent_id") || "";
  const phoneConfigId = url.searchParams.get("phone_config_id") || "";

  console.log(`Twilio callback: DialCallStatus=${dialCallStatus}, attempt=${attempt}, agent_id=${agentId}`);

  // If the call was answered/completed, no further action needed
  if (dialCallStatus === "completed" || dialCallStatus === "answered") {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  }

  // Call was not answered (busy, no-answer, failed, canceled) - try next number
  if (!agentId) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no one is available right now. Please try again later.</Say></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  }

  // Get forwarding numbers
  const { data: forwardingNumbers } = await supabase
    .from("call_forwarding_numbers")
    .select("*")
    .eq("agent_id", agentId)
    .order("priority", { ascending: true });

  if (!forwardingNumbers || attempt >= forwardingNumbers.length) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no one is available to take your call right now. Please try again later.</Say></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  }

  const destination = forwardingNumbers[attempt].phone_number;
  const hasNext = attempt + 1 < forwardingNumbers.length;

  console.log(`Twilio fallback: trying number ${attempt + 1}/${forwardingNumbers.length}: ${destination}`);

  if (hasNext) {
    const actionUrl = `${supabaseUrl}/functions/v1/transfer-call?attempt=${attempt + 1}&agent_id=${agentId}&phone_config_id=${phoneConfigId}`;
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial action="${actionUrl}" timeout="30">${destination}</Dial></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  } else {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="30">${destination}</Dial><Say>Sorry, no one is available to take your call right now. Please try again later.</Say></Response>`,
      { headers: { ...corsHeaders, "Content-Type": "text/xml" } }
    );
  }
}

// Handle Telnyx transfer with sequential fallback
async function handleTelnyxTransfer(phoneConfig: any, callSid: string, forwardingNumbers: any[], supabase: any) {
  const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
  if (!telnyxApiKey) {
    return new Response(
      JSON.stringify({ error: "Telnyx credentials not configured" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Try each number sequentially
  for (let i = 0; i < forwardingNumbers.length; i++) {
    const destination = forwardingNumbers[i].phone_number;
    const label = forwardingNumbers[i].label || `Person ${i + 1}`;

    console.log(`Telnyx transfer attempt ${i + 1}/${forwardingNumbers.length}: ${destination} (${label})`);

    const transferResponse = await fetch(
      `https://api.telnyx.com/v2/calls/${callSid}/actions/transfer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${telnyxApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: destination }),
      }
    );

    if (transferResponse.ok) {
      return new Response(
        JSON.stringify({ success: true, message: `Call transferred to ${destination} (${label})` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const err = await transferResponse.text();
    console.error(`Telnyx transfer to ${destination} failed:`, err);

    // If not the last number, continue to next
    if (i < forwardingNumbers.length - 1) {
      console.log(`Trying next forwarding number...`);
      continue;
    }
  }

  return new Response(
    JSON.stringify({ error: "All forwarding numbers failed" }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
