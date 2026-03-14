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
    // Twilio sends form-encoded POST
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

    // Map Twilio status to our status
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

    // Set ended_at for terminal statuses
    if (["completed", "busy", "no-answer", "canceled", "failed"].includes(status)) {
      updateData.ended_at = new Date().toISOString();
    }

    if (duration) {
      updateData.duration = parseInt(duration, 10);
    }

    // Add error info to summary if present
    if (errorCode || errorMessage) {
      updateData.summary = `Twilio Error ${errorCode || ""}: ${errorMessage || "Unknown error"}`.trim();
    }

    const { error: updateError } = await supabase.from("call_logs")
      .update(updateData)
      .eq("twilio_call_sid", callSid);

    if (updateError) {
      console.error(`[twilio-status] Failed to update call_logs: ${updateError.message}`);
    }

    // Twilio expects a 200 response
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[twilio-status] Error:", error);
    return new Response("OK", { status: 200 });
  }
});
