import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditEnterpriseMinutes } from "../_shared/minute-balance.ts";

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

    const { client_user_id, enterprise_rate_per_minute, purchase_amount } = await req.json();
    if (!client_user_id || enterprise_rate_per_minute == null || purchase_amount == null) {
      return new Response(JSON.stringify({ error: "client_user_id, enterprise_rate_per_minute and purchase_amount are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsedRate = Number(enterprise_rate_per_minute);
    const parsedAmount = Number(purchase_amount);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return new Response(JSON.stringify({ error: "enterprise_rate_per_minute must be a valid positive number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return new Response(JSON.stringify({ error: "purchase_amount must be a valid positive number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const credit = await creditEnterpriseMinutes(supabase as any, {
      userId: client_user_id,
      purchaseAmount: parsedAmount,
      ratePerMinute: parsedRate,
      adminEmail: ADMIN_EMAIL,
    });

    let updatedUser: { user?: unknown } | null = null;
    const { data: userData } = await supabase.auth.admin.getUserById(client_user_id);
    if (userData?.user) {
      const currentMetadata = userData.user.user_metadata ?? {};
      const nextMetadata = {
        ...currentMetadata,
        enterprise_interest: false,
        enterprise_updated_by: ADMIN_EMAIL,
        enterprise_updated_at: new Date().toISOString(),
      };

      const updateResult = await supabase.auth.admin.updateUserById(client_user_id, {
        user_metadata: nextMetadata,
      });

      if (!updateResult.error) {
        updatedUser = updateResult.data;
      }
    }

    return new Response(JSON.stringify({ success: true, user: updatedUser?.user ?? null, credit }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to update client enterprise plan",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
