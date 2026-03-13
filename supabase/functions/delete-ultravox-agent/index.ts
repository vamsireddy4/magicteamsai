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

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub;

    const { agent_id } = await req.json();
    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: "agent_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch agent to get ultravox_agent_id
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, ultravox_agent_id, user_id")
      .eq("id", agent_id)
      .eq("user_id", userId)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete from Ultravox if agent has an ultravox_agent_id
    if (agent.ultravox_agent_id && ultravoxApiKey) {
      console.log(`Deleting Ultravox agent: ${agent.ultravox_agent_id}`);
      try {
        const response = await fetch(
          `https://api.ultravox.ai/api/agents/${agent.ultravox_agent_id}`,
          {
            method: "DELETE",
            headers: { "X-API-Key": ultravoxApiKey },
          }
        );
        if (response.ok || response.status === 404) {
          console.log(`Ultravox agent deleted (status: ${response.status})`);
        } else {
          const errorText = await response.text();
          console.error(`Ultravox delete error (${response.status}): ${errorText}`);
        }
      } catch (err: any) {
        console.error(`Ultravox delete exception: ${err.message}`);
      }
    }

    // Delete from local database
    const { error: deleteError } = await supabase
      .from("agents")
      .delete()
      .eq("id", agent_id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error(`DB delete error: ${deleteError.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to delete agent from database" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("delete-ultravox-agent error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
