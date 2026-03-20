import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAIL = "saphaarelabs@gmail.com";

function decodeJwtPayload(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = decodeJwtPayload(authHeader.replace("Bearer ", ""));
    const userEmail = typeof payload?.email === "string" ? payload.email : null;
    if (userEmail !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [{ data: profiles, error: profilesError }, usersResult] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, company_name"),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (profilesError) {
      throw profilesError;
    }
    if (usersResult.error) {
      throw usersResult.error;
    }

    const userMap = new Map((usersResult.data.users ?? []).map((account) => [account.id, account]));
    const { data: balances, error: balancesError } = await supabase
      .from("user_minute_balances")
      .select("user_id, available_seconds, enterprise_rate_per_minute, last_enterprise_amount, last_enterprise_minutes");

    if (balancesError) {
      throw balancesError;
    }

    const balanceMap = new Map((balances ?? []).map((balance) => [balance.user_id, balance]));

    const clients = (profiles ?? [])
      .map((profile) => {
        const account = userMap.get(profile.user_id);
        if (!account?.email || account.email === ADMIN_EMAIL) {
          return null;
        }
        const metadata = account.user_metadata ?? {};
        const balance = balanceMap.get(profile.user_id);
        return {
          user_id: profile.user_id,
          email: account.email,
          full_name: profile.full_name ?? (typeof metadata.full_name === "string" ? metadata.full_name : null),
          company_name: profile.company_name ?? null,
          enterprise_interest: Boolean(metadata.enterprise_interest),
          available_seconds: balance?.available_seconds ?? 0,
          enterprise_rate_per_minute: balance?.enterprise_rate_per_minute ?? null,
          last_enterprise_amount: balance?.last_enterprise_amount ?? null,
          last_enterprise_minutes: balance?.last_enterprise_minutes ?? null,
        };
      })
      .filter((client): client is NonNullable<typeof client> => client !== null)
      .sort((a, b) => {
        if (a.enterprise_interest !== b.enterprise_interest) {
          return a.enterprise_interest ? -1 : 1;
        }
        return a.email.localeCompare(b.email);
      });

    return new Response(JSON.stringify({ clients }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to list clients",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
