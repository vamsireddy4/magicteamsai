import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload ?? {};
    const callControlId = payload?.call_control_id;

    console.log(`[telnyx-webhook] Event: ${eventType}, call_control_id: ${callControlId}`);

    if (!callControlId) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (eventType === "call.answered") {
      // Look up the stored join URL for this call
      const { data: callState, error } = await supabase
        .from("telnyx_call_state")
        .select("*")
        .eq("call_control_id", callControlId)
        .single();

      if (error || !callState) {
        console.log(`[telnyx-webhook] No call state found for ${callControlId}, might be using inline stream params`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[telnyx-webhook] Starting streaming for call ${callControlId} -> ${callState.join_url}`);

      // Start bidirectional streaming to Ultravox
      const streamResponse = await fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${callState.telnyx_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stream_url: callState.join_url,
            stream_track: "both_tracks",
            stream_bidirectional_mode: "rtp",
            stream_codec: "PCMU",
            stream_bidirectional_codec: "PCMU",
            stream_bidirectional_sampling_rate: 8000,
            stream_bidirectional_target_legs: "self",
          }),
        }
      );

      if (!streamResponse.ok) {
        const err = await streamResponse.text();
        console.error(`[telnyx-webhook] streaming_start failed: ${err}`);
      } else {
        console.log(`[telnyx-webhook] Streaming started successfully for ${callControlId}`);
      }

      // Clean up the state record
      await supabase.from("telnyx_call_state").delete().eq("call_control_id", callControlId);
    }

    if (eventType === "streaming.started") {
      console.log(`[telnyx-webhook] streaming.started payload: ${JSON.stringify(payload)}`);
    }

    if (eventType === "streaming.stopped") {
      console.log(`[telnyx-webhook] streaming.stopped payload: ${JSON.stringify(payload)}`);
    }

    if (eventType === "call.hangup") {
      // Clean up any remaining state
      await supabase.from("telnyx_call_state").delete().eq("call_control_id", callControlId);
      console.log(`[telnyx-webhook] Call hung up: ${callControlId}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[telnyx-webhook] Error:", error);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
