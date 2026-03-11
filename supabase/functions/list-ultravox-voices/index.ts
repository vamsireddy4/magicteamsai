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
    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data, error } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (error || !data?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");
    if (!ultravoxApiKey) {
      return new Response(JSON.stringify({ error: "ULTRAVOX_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = {
      "Content-Type": "application/json",
      "X-API-Key": ultravoxApiKey,
    };

    // Fetch all voices (paginated) and models in parallel
    const fetchAllVoices = async () => {
      const allVoices: any[] = [];
      let url: string | null = "https://api.ultravox.ai/api/voices?pageSize=100";
      while (url) {
        const res = await fetch(url, { headers });
        if (!res.ok) break;
        const data = await res.json();
        allVoices.push(...(data.results || []));
        url = data.next || null;
      }
      return allVoices;
    };

    const fetchAllModels = async () => {
      const allModels: any[] = [];
      let url: string | null = "https://api.ultravox.ai/api/models?pageSize=100";
      while (url) {
        const res = await fetch(url, { headers });
        if (!res.ok) break;
        const data = await res.json();
        allModels.push(...(data.results || []));
        url = data.next || null;
      }
      return allModels;
    };

    const [voices, models] = await Promise.all([
      fetchAllVoices(),
      fetchAllModels(),
    ]);

    return new Response(
      JSON.stringify({
        voices,
        models,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching Ultravox data:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
