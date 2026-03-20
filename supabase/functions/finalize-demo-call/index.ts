import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deductMinutesForCall } from "../_shared/minute-balance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const payload = decodeJwtPayload(token);
    const userId = typeof payload?.sub === "string" ? payload.sub : null;

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized", details: "Unable to resolve user from token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { log_id, status, ended_at, duration, transcript, ultravox_call_id } = await req.json();

    if (!log_id) {
      return new Response(JSON.stringify({ error: "log_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updatePayload: Record<string, unknown> = {
      status: status || "completed",
      ended_at: ended_at || new Date().toISOString(),
      duration: Number(duration || 0),
      transcript: transcript || [],
    };

    if (ultravox_call_id) {
      updatePayload.ultravox_call_id = ultravox_call_id;
    }

    const { error } = await supabase
      .from("call_logs")
      .update(updatePayload)
      .eq("id", log_id)
      .eq("user_id", userId)
      .eq("direction", "demo");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((status || "completed") === "completed") {
      await deductMinutesForCall(supabase as any, {
        userId,
        callLogId: log_id,
        durationSeconds: Number(duration || 0),
        kind: "demo_deduction",
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
