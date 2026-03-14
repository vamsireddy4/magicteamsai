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
        console.error(`[twilio-status] webhook dispatch failed (${hook.url}):`, err);
      }
    })
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const callSid = formData.get("CallSid") as string;
    const callStatus = formData.get("CallStatus") as string;
    const errorCode = formData.get("ErrorCode") as string | null;
    const errorMessage = formData.get("ErrorMessage") as string | null;
    const duration = formData.get("CallDuration") as string | null;

    console.log(`[twilio-status] CallSid=${callSid}, Status=${callStatus}, ErrorCode=${errorCode}, ErrorMessage=${errorMessage}, Duration=${duration}`);

    if (!callSid) {
      return new Response("OK", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: callLog } = await supabase
      .from("call_logs")
      .select("id, agent_id, user_id, status, caller_number, recipient_number, twilio_call_sid, ultravox_call_id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    let status = "initiated";
    switch (callStatus) {
      case "queued":
      case "ringing":
      case "initiated":
        status = "initiated";
        break;
      case "in-progress":
        status = "in-progress";
        break;
      case "completed":
        status = "completed";
        break;
      case "busy":
        status = "busy";
        break;
      case "no-answer":
        status = "no-answer";
        break;
      case "canceled":
        status = "canceled";
        break;
      case "failed":
        status = "failed";
        break;
      default:
        status = callStatus || "unknown";
    }

    const updateData: any = { status };
    if (TERMINAL_STATUSES.has(status)) {
      updateData.ended_at = new Date().toISOString();
    }
    if (duration) {
      updateData.duration = parseInt(duration, 10);
    }
    if (errorCode || errorMessage) {
      updateData.summary = `Twilio Error ${errorCode || ""}: ${errorMessage || "Unknown error"}`.trim();
    }

    const { error: updateError } = await supabase
      .from("call_logs")
      .update(updateData)
      .eq("twilio_call_sid", callSid);

    if (updateError) {
      console.error(`[twilio-status] Failed to update call_logs: ${updateError.message}`);
    }

    if (callLog?.agent_id) {
      const wasTerminal = TERMINAL_STATUSES.has(callLog.status || "");

      if (status === "in-progress" && callLog.status !== "in-progress") {
        await fireAgentWebhooks(supabase, callLog.agent_id, "call.started", {
          call_sid: callSid,
          call_log_id: callLog.id,
          agent_id: callLog.agent_id,
          direction: "outbound",
          caller_number: callLog.caller_number,
          recipient_number: callLog.recipient_number,
          provider: "twilio",
        });
      }

      if (TERMINAL_STATUSES.has(status) && !wasTerminal) {
        await fireAgentWebhooks(supabase, callLog.agent_id, "call.ended", {
          call_sid: callSid,
          call_log_id: callLog.id,
          agent_id: callLog.agent_id,
          direction: "outbound",
          caller_number: callLog.caller_number,
          recipient_number: callLog.recipient_number,
          provider: "twilio",
          status,
          duration_seconds: duration ? parseInt(duration, 10) : null,
          error_code: errorCode,
          error_message: errorMessage,
        });
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[twilio-status] Error:", error);
    return new Response("OK", { status: 200 });
  }
});