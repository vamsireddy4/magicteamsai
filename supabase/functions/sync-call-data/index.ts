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

    // Fetch call_logs with ultravox_call_id that need syncing (no duration or no transcript)
    const { data: calls, error: fetchError } = await supabase
      .from("call_logs")
      .select("id, ultravox_call_id, twilio_call_sid, started_at, duration, transcript")
      .eq("user_id", user.id)
      .not("ultravox_call_id", "is", null)
      .or("duration.is.null,transcript.is.null");

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
        // Fetch call details and messages (transcript) in parallel
        const [callRes, messagesRes] = await Promise.all([
          fetch(`https://api.ultravox.ai/api/calls/${call.ultravox_call_id}`, {
            headers: { "X-API-Key": ultravoxApiKey },
          }),
          call.transcript === null
            ? fetch(`https://api.ultravox.ai/api/calls/${call.ultravox_call_id}/messages`, {
                headers: { "X-API-Key": ultravoxApiKey },
              })
            : Promise.resolve(null),
        ]);

        if (!callRes.ok) {
          errors.push(`Failed to fetch call ${call.ultravox_call_id}: ${callRes.status}`);
          continue;
        }

        const data = await callRes.json();
        const updateData: Record<string, unknown> = {};

        // Parse duration
        if (call.duration === null) {
          let durationSeconds: number | null = null;
          if (data.billedDuration) {
            const match = data.billedDuration.match(/^([\d.]+)s$/);
            if (match) {
              durationSeconds = Math.round(parseFloat(match[1]));
            }
          }
          if (durationSeconds === null && data.joined && data.ended) {
            const joinedAt = new Date(data.joined).getTime();
            const endedAt = new Date(data.ended).getTime();
            durationSeconds = Math.round((endedAt - joinedAt) / 1000);
          }
          if (durationSeconds !== null && durationSeconds >= 0) {
            updateData.duration = durationSeconds;
          }
        }

        // Timing
        if (data.ended) {
          updateData.ended_at = data.ended;
        }
        if (data.joined) {
          updateData.started_at = data.joined;
        }

        // Status
        if (data.endReason === "hangup" || data.endReason === "disconnect" || data.ended) {
          updateData.status = "completed";
        }

        // Transcript — parse messages from Ultravox
        if (call.transcript === null && messagesRes && messagesRes.ok) {
          const messagesData = await messagesRes.json();
          const messages = messagesData.results || messagesData;

          if (Array.isArray(messages) && messages.length > 0) {
            // Format transcript as array of { role, text, timestamp }
            const transcript = messages
              .filter((m: any) => m.role && m.text)
              .map((m: any) => ({
                role: m.role === "MESSAGE_ROLE_AGENT" ? "agent" : m.role === "MESSAGE_ROLE_USER" ? "user" : m.role,
                text: m.text,
                timestamp: m.created || m.ordinal || null,
              }));

            if (transcript.length > 0) {
              updateData.transcript = transcript;
            }
          }
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
