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
    const { call_sid, destination_number, provider } = await req.json();

    if (!call_sid || !destination_number) {
      return new Response(
        JSON.stringify({ error: "call_sid and destination_number are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Transfer call ${call_sid} to ${destination_number} via ${provider}`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the call log to get phone config details
    const { data: callLog } = await supabase
      .from("call_logs")
      .select("*, agents(phone_number_id)")
      .or(`twilio_call_sid.eq.${call_sid},ultravox_call_id.eq.${call_sid}`)
      .limit(1)
      .single();

    if (!callLog) {
      return new Response(
        JSON.stringify({ error: "Call not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get phone config for credentials
    const phoneNumberId = (callLog as any).agents?.phone_number_id;
    let phoneConfig: any = null;
    if (phoneNumberId) {
      const { data } = await supabase
        .from("phone_configs")
        .select("*")
        .eq("id", phoneNumberId)
        .single();
      phoneConfig = data;
    }

    if (!phoneConfig) {
      // Try to find by the caller/recipient number
      const number = callLog.direction === "inbound" ? callLog.recipient_number : callLog.caller_number;
      if (number) {
        const { data } = await supabase
          .from("phone_configs")
          .select("*")
          .eq("phone_number", number)
          .limit(1)
          .single();
        phoneConfig = data;
      }
    }

    if (!phoneConfig) {
      return new Response(
        JSON.stringify({ error: "Phone config not found for this call" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callProvider = provider || phoneConfig.provider || "twilio";

    if (callProvider === "telnyx") {
      const telnyxApiKey = (phoneConfig.telnyx_api_key || "").trim();
      if (!telnyxApiKey) {
        return new Response(
          JSON.stringify({ error: "Telnyx credentials not configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use Telnyx Call Control transfer API
      const transferResponse = await fetch(
        `https://api.telnyx.com/v2/calls/${call_sid}/actions/transfer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${telnyxApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to: destination_number }),
        }
      );

      if (!transferResponse.ok) {
        const err = await transferResponse.text();
        console.error("Telnyx transfer error:", err);
        return new Response(
          JSON.stringify({ error: "Transfer failed", details: err }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: `Call transferred to ${destination_number}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Twilio: update the call with TwiML to dial the destination
      const twilioAccountSid = (phoneConfig.twilio_account_sid || "").replace(/[^a-zA-Z0-9]/g, "");
      const twilioAuthToken = (phoneConfig.twilio_auth_token || "").replace(/[^a-zA-Z0-9]/g, "");

      if (!twilioAccountSid || !twilioAuthToken) {
        return new Response(
          JSON.stringify({ error: "Twilio credentials not configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Use the actual Twilio call SID (not ultravox call id)
      const actualCallSid = callLog.twilio_call_sid || call_sid;

      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${destination_number}</Dial></Response>`;

      const updateResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls/${actualCallSid}.json`,
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
        JSON.stringify({ success: true, message: `Call transferred to ${destination_number}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
