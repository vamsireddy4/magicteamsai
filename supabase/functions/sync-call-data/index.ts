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
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: claimsData.claims.sub as string };

    // Fetch call_logs that need syncing — include any call that isn't fully resolved
    const { data: calls, error: fetchError } = await supabase
      .from("call_logs")
      .select("id, ultravox_call_id, twilio_call_sid, caller_number, recipient_number, started_at, duration, transcript, status, agent_id")
      .eq("user_id", user.id)
      .or("duration.is.null,transcript.is.null,summary.is.null,status.eq.initiated,status.eq.in-progress");

    console.log(`Found ${calls?.length || 0} calls to sync`);

    if (fetchError) {
      console.error("Fetch error:", fetchError.message);
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

    // Pre-fetch phone configs for Twilio lookups (group by caller_number)
    const callerNumbers = [...new Set(calls.filter(c => c.caller_number).map(c => c.caller_number!))];
    const { data: phoneConfigs } = await supabase
      .from("phone_configs")
      .select("phone_number, twilio_account_sid, twilio_auth_token, provider")
      .eq("user_id", user.id)
      .in("phone_number", callerNumbers);

    const phoneConfigMap = new Map<string, { sid: string; token: string }>();
    if (phoneConfigs) {
      for (const pc of phoneConfigs) {
        if (pc.twilio_account_sid && pc.twilio_auth_token) {
          phoneConfigMap.set(pc.phone_number, {
            sid: pc.twilio_account_sid.replace(/[^a-zA-Z0-9]/g, ''),
            token: pc.twilio_auth_token.replace(/[^a-zA-Z0-9]/g, ''),
          });
        }
      }
    }

    let updated = 0;
    const errors: string[] = [];

    for (const call of calls) {
      try {
        const updateData: Record<string, unknown> = {};

        if (call.ultravox_call_id && ultravoxApiKey) {
          // --- ULTRAVOX SYNC ---
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
            errors.push(`Ultravox fetch failed for ${call.ultravox_call_id}: ${callRes.status}`);
            continue;
          }

          const data = await callRes.json();

          if (call.duration === null) {
            let durationSeconds: number | null = null;
            if (data.billedDuration) {
              const match = data.billedDuration.match(/^([\d.]+)s$/);
              if (match) durationSeconds = Math.round(parseFloat(match[1]));
            }
            if (durationSeconds === null && data.joined && data.ended) {
              durationSeconds = Math.round((new Date(data.ended).getTime() - new Date(data.joined).getTime()) / 1000);
            }
            if (durationSeconds !== null && durationSeconds >= 0) updateData.duration = durationSeconds;
          }

          if (data.ended) updateData.ended_at = data.ended;
          if (data.joined) updateData.started_at = data.joined;
          if (data.endReason === "hangup" || data.endReason === "disconnect" || data.ended) {
            updateData.status = "completed";
          }

          // Fetch summary from Ultravox instead of AI
          if (data.shortSummary || data.summary) {
            updateData.summary = data.shortSummary || data.summary;
            console.log(`Fetched Ultravox summary for call ${call.id}`);
          }

          if (call.transcript === null && messagesRes && messagesRes.ok) {
            const messagesData = await messagesRes.json();
            const messages = messagesData.results || messagesData;
            if (Array.isArray(messages) && messages.length > 0) {
              const transcript = messages
                .filter((m: any) => m.role && m.text)
                .map((m: any) => ({
                  role: m.role === "MESSAGE_ROLE_AGENT" ? "agent" : m.role === "MESSAGE_ROLE_USER" ? "user" : m.role,
                  text: m.text,
                  timestamp: m.created || m.ordinal || null,
                }));
              if (transcript.length > 0) updateData.transcript = transcript;
            }
          }

        } else if (call.twilio_call_sid) {
          // --- TWILIO SYNC ---
          const creds = call.caller_number ? phoneConfigMap.get(call.caller_number) : null;
          if (!creds) {
            errors.push(`No Twilio creds for call ${call.id} (caller: ${call.caller_number})`);
            continue;
          }

          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Calls/${call.twilio_call_sid}.json`,
            {
              headers: {
                "Authorization": `Basic ${btoa(`${creds.sid}:${creds.token}`)}`,
              },
            }
          );

          if (!twilioRes.ok) {
            errors.push(`Twilio fetch failed for ${call.twilio_call_sid}: ${twilioRes.status}`);
            continue;
          }

          const twilioData = await twilioRes.json();

          // Duration
          if (call.duration === null && twilioData.duration) {
            const dur = parseInt(twilioData.duration, 10);
            if (!isNaN(dur) && dur >= 0) updateData.duration = dur;
          }

          // Status mapping
          const twilioStatus = twilioData.status;
          if (twilioStatus === "completed") {
            updateData.status = "completed";
          } else if (twilioStatus === "busy" || twilioStatus === "no-answer" || twilioStatus === "canceled") {
            updateData.status = twilioStatus;
          } else if (twilioStatus === "failed") {
            updateData.status = "failed";
          } else if (twilioStatus === "in-progress") {
            updateData.status = "in-progress";
          }

          // Timing
          if (twilioData.start_time) updateData.started_at = new Date(twilioData.start_time).toISOString();
          if (twilioData.end_time) updateData.ended_at = new Date(twilioData.end_time).toISOString();

          // Try to fetch Twilio recording transcript if available
          if (call.transcript === null) {
            try {
              const recordingsRes = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Calls/${call.twilio_call_sid}/Recordings.json`,
                {
                  headers: {
                    "Authorization": `Basic ${btoa(`${creds.sid}:${creds.token}`)}`,
                  },
                }
              );
              if (recordingsRes.ok) {
                const recData = await recordingsRes.json();
                if (recData.recordings && recData.recordings.length > 0) {
                  // Note: Twilio transcriptions require separate setup; mark as unavailable for now
                  // We store a placeholder so we don't keep re-fetching
                }
              }
            } catch (_) {
              // Transcript fetch is best-effort
            }
          }
        } else {
          continue;
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

            // Update corresponding call_outcome based on call status
            const finalStatus = (updateData.status as string) ?? call.status;
            const duration = (updateData.duration as number) ?? call.duration;
            console.log(`Call ${call.id}: finalStatus=${finalStatus}, duration=${duration}, recipient=${call.recipient_number}`);
            
            if (finalStatus && finalStatus !== "initiated") {
              let outcome: string | null = null;
              if (finalStatus === "completed" && duration && duration > 10) {
                outcome = "ANSWERED";
              } else if (finalStatus === "completed" && (!duration || duration <= 10)) {
                outcome = "VOICEMAIL";
              } else if (finalStatus === "no-answer" || finalStatus === "canceled" || finalStatus === "busy") {
                outcome = "NO_ANSWER";
              } else if (finalStatus === "failed") {
                outcome = "DECLINED";
              }

              console.log(`Mapped outcome: ${outcome} for recipient: ${call.recipient_number}`);

              if (outcome && call.recipient_number) {
                const { data: pendingOutcomes, error: poErr } = await supabase
                  .from("call_outcomes")
                  .select("id")
                  .eq("user_id", user.id)
                  .eq("phone_number", call.recipient_number)
                  .eq("outcome", "PENDING")
                  .order("created_at", { ascending: false })
                  .limit(1);

                console.log(`Found ${pendingOutcomes?.length || 0} pending outcomes for ${call.recipient_number}`, poErr?.message || "");

                if (pendingOutcomes && pendingOutcomes.length > 0) {
                  const { error: upErr } = await supabase
                    .from("call_outcomes")
                    .update({ outcome })
                    .eq("id", pendingOutcomes[0].id);
                  console.log(`Updated outcome ${pendingOutcomes[0].id} to ${outcome}`, upErr?.message || "ok");
                }
              }
            }
          }
        }
      } catch (e) {
        errors.push(`Error processing call ${call.id}: ${e.message}`);
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
