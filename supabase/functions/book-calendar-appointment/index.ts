import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ultravox-tool-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === supabaseKey;

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const body = await req.json();
    const { integration_id, start_time, end_time, attendee_name, attendee_email, attendee_phone, notes } = body;

    let query = supabase.from("calendar_integrations").select("*").eq("id", integration_id);
    if (!isServiceRole && userId) {
      query = query.eq("user_id", userId);
    }
    const { data: integration, error: intError } = await query.single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: "Calendar integration not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any = {};

    if (integration.provider === "google_calendar") {
      result = await bookGoogleCalendar(integration, { start_time, end_time, attendee_name, attendee_email, notes });
    } else if (integration.provider === "cal_com") {
      result = await bookCalCom(integration, { start_time, end_time, attendee_name, attendee_email, attendee_phone, notes });
    } else if (integration.provider === "gohighlevel") {
      result = await bookGoHighLevel(integration, { start_time, end_time, attendee_name, attendee_email, attendee_phone, notes });
    }

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Calendar booking error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function bookGoogleCalendar(integration: any, opts: any) {
  return {
    success: false,
    message: "Google Calendar booking requires OAuth credentials (not just an API key). Please use a service account or OAuth flow for write access.",
  };
}

// Cal.com v2 API booking
async function bookCalCom(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const eventTypeId = integration.calendar_id;

  if (!eventTypeId || isNaN(Number(eventTypeId))) {
    throw new Error("Cal.com booking requires a valid numeric Event Type ID.");
  }

  const res = await fetch("https://api.cal.com/v2/bookings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cal-api-version": "2024-08-13",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      eventTypeId: parseInt(eventTypeId),
      start: opts.start_time,
      attendee: {
        name: opts.attendee_name || "Guest",
        email: opts.attendee_email || "guest@example.com",
        timeZone: "UTC",
        language: "en",
      },
      metadata: {
        phone: opts.attendee_phone || "",
        notes: opts.notes || "",
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("Cal.com v2 booking error:", res.status, errBody);
    throw new Error(`Cal.com booking error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return { success: true, booking: data.data || data };
}

async function bookGoHighLevel(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const calendarId = integration.calendar_id;

  const res = await fetch("https://rest.gohighlevel.com/v1/appointments/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      calendarId,
      startTime: opts.start_time,
      endTime: opts.end_time,
      title: `Call with ${opts.attendee_name || "Guest"}`,
      contactId: null,
      email: opts.attendee_email,
      phone: opts.attendee_phone,
      notes: opts.notes,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GoHighLevel booking error: ${err.message || res.statusText}`);
  }

  const data = await res.json();
  return { success: true, appointment: data };
}
