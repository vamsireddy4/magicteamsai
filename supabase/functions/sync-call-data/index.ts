import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch call_logs with ultravox_call_id that have null duration
    const { data: calls, error: fetchError } = await supabase
      .from("call_logs")
      .select("id, ultravox_call_id, started_at")
      .eq("user_id", user.id)
      .not("ultravox_call_id", "is", null)
      .is("duration", null);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!calls || calls.length === 0) {
      return new Response(JSON.stringify({ message: "No calls to sync", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    const errors: string[] = [];

    for (const call of calls) {
      try {
        const res = await fetch(`https://api.ultravox.ai/api/calls/${call.ultravox_call_id}`, {
          headers: { "X-API-Key": ultravoxApiKey },
        });

        if (!res.ok) {
          errors.push(`Failed to fetch call ${call.ultravox_call_id}: ${res.status}`);
          continue;
        }

        const data = await res.json();

        // Parse duration from Ultravox (format: "123s" or "123.456s")
        let durationSeconds: number | null = null;
        if (data.billedDuration) {
          const match = data.billedDuration.match(/^([\d.]+)s$/);
          if (match) {
            durationSeconds = Math.round(parseFloat(match[1]));
          }
        }

        // If no billedDuration, calculate from joined/ended
        if (durationSeconds === null && data.joined && data.ended) {
          const joinedAt = new Date(data.joined).getTime();
          const endedAt = new Date(data.ended).getTime();
          durationSeconds = Math.round((endedAt - joinedAt) / 1000);
        }

        const updateData: Record<string, unknown> = {};
        if (durationSeconds !== null && durationSeconds >= 0) {
          updateData.duration = durationSeconds;
        }
        if (data.ended) {
          updateData.ended_at = data.ended;
        }
        if (data.joined) {
          updateData.started_at = data.joined;
        }
        if (data.endReason === "hangup" || data.endReason === "disconnect" || data.ended) {
          updateData.status = "completed";
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from("call_logs")
            .update(updateData)
            .eq("id", call.id);

          if (updateError) {
            errors.push(`Failed to update call ${call.id}: ${updateError.message}`);
          } else {
            updated++;
          }
        }
      } catch (e) {
        errors.push(`Error processing call ${call.ultravox_call_id}: ${e.message}`);
      }
    }

    return new Response(
      JSON.stringify({ message: `Synced ${updated} calls`, updated, total: calls.length, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
