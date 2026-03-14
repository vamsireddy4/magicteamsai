import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TERMINAL_STATUSES = new Set(["completed", "busy", "no-answer", "canceled", "failed"]);

async function fireAgentWebhooks(supabase: any, agentId: string, event: string, payload: Record<string, any>) {
  if (!agentId) return;

  const { data: hooks } = await supabase
    .from("webhooks")
    .select("id, url, secret, events, is_active")
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .contains("events", [event]);

  if (!hooks?.length) return;

  await Promise.all(
    hooks.map(async (hook: any) => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (hook.secret) headers["X-Webhook-Secret"] = hook.secret;

        await fetch(hook.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event,
            timestamp: new Date().toISOString(),
            ...payload,
          }),
        });
      } catch (err) {
        console.error(`[telnyx-webhook] webhook dispatch failed (${hook.url}):`, err);
      }
    })
  );
}

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

    const { data: existingCallLog } = await supabase
      .from("call_logs")
      .select("id, agent_id, user_id, status, caller_number, recipient_number, twilio_call_sid, ultravox_call_id")
      .eq("twilio_call_sid", callControlId)
      .maybeSingle();

    if (eventType === "call.initiated") {
      console.log(`[telnyx-webhook] call.initiated full payload: ${JSON.stringify(payload)}`);
    }

    if (eventType === "call.answered") {
      const { data: callState, error } = await supabase
        .from("telnyx_call_state")
        .select("*")
        .eq("call_control_id", callControlId)
        .single();

      if (error || !callState) {
        console.log(`[telnyx-webhook] No call state found for ${callControlId}, might be using inline stream params`);
      } else {
        console.log(`[telnyx-webhook] Starting streaming for call ${callControlId} -> ${callState.join_url}`);

        const streamResponse = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${callState.telnyx_api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              stream_url: callState.join_url,
              stream_track: "inbound_track",
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

        await supabase.from("telnyx_call_state").delete().eq("call_control_id", callControlId);
      }

      await supabase
        .from("call_logs")
        .update({ status: "in-progress" })
        .eq("twilio_call_sid", callControlId);

      if (existingCallLog?.agent_id && existingCallLog.status !== "in-progress") {
        await fireAgentWebhooks(supabase, existingCallLog.agent_id, "call.started", {
          call_sid: callControlId,
          call_log_id: existingCallLog.id,
          agent_id: existingCallLog.agent_id,
          direction: "outbound",
          caller_number: existingCallLog.caller_number,
          recipient_number: existingCallLog.recipient_number,
          provider: "telnyx",
        });
      }
    }

    if (eventType === "streaming.started") {
      console.log(`[telnyx-webhook] streaming.started payload: ${JSON.stringify(payload)}`);
    }

    if (eventType === "streaming.stopped") {
      console.log(`[telnyx-webhook] streaming.stopped payload: ${JSON.stringify(payload)}`);
    }

    if (eventType === "call.hangup") {
      const hangupCause = payload?.hangup_cause || "unknown";
      const hangupSource = payload?.hangup_source || "unknown";
      const sipResponseCode = payload?.sip_hangup_cause || "";

      console.log(`[telnyx-webhook] Call hung up: ${callControlId}, cause=${hangupCause}, source=${hangupSource}, sip_code=${sipResponseCode}`);
      console.log(`[telnyx-webhook] call.hangup full payload: ${JSON.stringify(payload)}`);

      let callStatus = "completed";
      const normalizedCause = String(hangupCause).toLowerCase();
      if (normalizedCause.includes("busy") || normalizedCause.includes("rejected")) {
        callStatus = "busy";
      } else if (normalizedCause.includes("no_answer") || normalizedCause.includes("timeout") || normalizedCause.includes("cancel")) {
        callStatus = "no-answer";
      } else if (normalizedCause.includes("unallocated") || normalizedCause.includes("no_route") || normalizedCause.includes("invalid")) {
        callStatus = "failed";
      }

      const { error: updateError } = await supabase
        .from("call_logs")
        .update({
          status: callStatus,
          ended_at: new Date().toISOString(),
          summary: `Hangup cause: ${hangupCause} (source: ${hangupSource})${sipResponseCode ? `, SIP: ${sipResponseCode}` : ""}`,
        })
        .eq("twilio_call_sid", callControlId);

      if (updateError) {
        console.error(`[telnyx-webhook] Failed to update call_logs: ${updateError.message}`);
      }

      const terminalAlreadySet = existingCallLog?.status ? TERMINAL_STATUSES.has(existingCallLog.status) : false;
      if (existingCallLog?.agent_id && !terminalAlreadySet) {
        await fireAgentWebhooks(supabase, existingCallLog.agent_id, "call.ended", {
          call_sid: callControlId,
          call_log_id: existingCallLog.id,
          agent_id: existingCallLog.agent_id,
          direction: "outbound",
          caller_number: existingCallLog.caller_number,
          recipient_number: existingCallLog.recipient_number,
          provider: "telnyx",
          status: callStatus,
          hangup_cause: hangupCause,
          hangup_source: hangupSource,
          sip_code: sipResponseCode,
        });
      }

      await supabase.from("telnyx_call_state").delete().eq("call_control_id", callControlId);
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