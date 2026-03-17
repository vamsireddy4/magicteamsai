import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TERMINAL_STATUSES = new Set(["completed", "busy", "no-answer", "canceled", "failed"]);
const TELNYX_TRANSFER_STATE_PREFIX = "transfer-state:";
const TELNYX_TRANSFER_LEG_TYPE = "transfer-leg";

function decodeTelnyxTransferState(value: string | null | undefined) {
  if (!value || !value.startsWith(TELNYX_TRANSFER_STATE_PREFIX)) return null;
  try {
    return JSON.parse(atob(value.slice(TELNYX_TRANSFER_STATE_PREFIX.length)));
  } catch {
    return null;
  }
}

function encodeTelnyxTransferState(payload: {
  currentIndex: number;
  forwardingNumbers: Array<{ phone_number: string; label?: string | null }>;
  fromNumber: string;
  currentLegAnswered?: boolean;
}) {
  return `${TELNYX_TRANSFER_STATE_PREFIX}${btoa(JSON.stringify(payload))}`;
}

function decodeTelnyxTransferLegState(value: string | null | undefined) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(atob(value));
    if (decoded?.type === TELNYX_TRANSFER_LEG_TYPE && decoded?.originalCallControlId) {
      return decoded as { type: string; originalCallControlId: string; currentIndex: number };
    }
  } catch {
    // ignore
  }
  return null;
}

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
      const legTransferState = decodeTelnyxTransferLegState(payload?.client_state);
      const { data: callState, error } = await supabase
        .from("telnyx_call_state")
        .select("*")
        .eq("call_control_id", callControlId)
        .single();

      const transferState = decodeTelnyxTransferState(callState?.join_url);

      if (error || !callState) {
        if (legTransferState?.originalCallControlId) {
          const { data: originalCallState } = await supabase
            .from("telnyx_call_state")
            .select("*")
            .eq("call_control_id", legTransferState.originalCallControlId)
            .maybeSingle();
          const originalTransferState = decodeTelnyxTransferState(originalCallState?.join_url);
          if (originalTransferState) {
            console.log(`[telnyx-webhook] call.answered for transferred leg ${callControlId}, marking original chain as answered`);
            await supabase
              .from("telnyx_call_state")
              .update({
                join_url: encodeTelnyxTransferState({
                  currentIndex: legTransferState.currentIndex,
                  forwardingNumbers: originalTransferState.forwardingNumbers,
                  fromNumber: originalTransferState.fromNumber,
                  currentLegAnswered: true,
                }),
              })
              .eq("call_control_id", legTransferState.originalCallControlId);
          }
        } else {
          console.log(`[telnyx-webhook] No call state found for ${callControlId}, might be using inline stream params`);
        }
      } else if (transferState) {
        console.log(`[telnyx-webhook] call.answered for transfer state ${callControlId}, no AI stream attach needed`);
        await supabase
          .from("telnyx_call_state")
          .update({
            join_url: encodeTelnyxTransferState({
              currentIndex: transferState.currentIndex,
              forwardingNumbers: transferState.forwardingNumbers,
              fromNumber: transferState.fromNumber,
              currentLegAnswered: true,
            }),
          })
          .eq("call_control_id", callControlId);
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

      const legTransferState = decodeTelnyxTransferLegState(payload?.client_state);
      const { data: callState } = await supabase
        .from("telnyx_call_state")
        .select("*")
        .eq("call_control_id", callControlId)
        .maybeSingle();

      const transferState = decodeTelnyxTransferState(callState?.join_url);
      const originalTransferCallControlId = legTransferState?.originalCallControlId || callControlId;

      let originalTransferState = transferState;
      let originalCallState = callState;
      if (legTransferState?.originalCallControlId && legTransferState.originalCallControlId !== callControlId) {
        const { data } = await supabase
          .from("telnyx_call_state")
          .select("*")
          .eq("call_control_id", legTransferState.originalCallControlId)
          .maybeSingle();
        originalCallState = data;
        originalTransferState = decodeTelnyxTransferState(data?.join_url);
      }

      const currentTransferIndex = legTransferState?.currentIndex ?? originalTransferState?.currentIndex ?? 0;
      const currentLegAnswered = Boolean(originalTransferState?.currentLegAnswered);
      const shouldRetryTransfer =
        originalTransferState &&
        !currentLegAnswered &&
        (callStatus === "busy" || callStatus === "no-answer" || callStatus === "failed" || callStatus === "completed") &&
        currentTransferIndex + 1 < originalTransferState.forwardingNumbers.length;

      if (shouldRetryTransfer) {
        const nextIndex = currentTransferIndex + 1;
        const nextEntry = originalTransferState.forwardingNumbers[nextIndex];
        console.log(`[telnyx-webhook] Transfer fallback ${nextIndex + 1}/${originalTransferState.forwardingNumbers.length}: ${nextEntry.phone_number}`);

        const transferResponse = await fetch(
          `https://api.telnyx.com/v2/calls/${originalTransferCallControlId}/actions/transfer`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${originalCallState.telnyx_api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: nextEntry.phone_number,
              from: originalTransferState.fromNumber,
              timeout_secs: 10,
              park_after_unbridge: "self",
              target_leg_client_state: btoa(JSON.stringify({
                type: TELNYX_TRANSFER_LEG_TYPE,
                originalCallControlId: originalTransferCallControlId,
                currentIndex: nextIndex,
              })),
              command_id: crypto.randomUUID(),
            }),
          }
        );

        if (transferResponse.ok) {
          await supabase
            .from("telnyx_call_state")
            .update({
              join_url: encodeTelnyxTransferState({
                currentIndex: nextIndex,
                forwardingNumbers: originalTransferState.forwardingNumbers,
                fromNumber: originalTransferState.fromNumber,
                currentLegAnswered: false,
              }),
            })
            .eq("call_control_id", originalTransferCallControlId);

          return new Response(JSON.stringify({ ok: true, retried: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const retryErr = await transferResponse.text();
        console.error(`[telnyx-webhook] Transfer fallback failed: ${retryErr}`);
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
