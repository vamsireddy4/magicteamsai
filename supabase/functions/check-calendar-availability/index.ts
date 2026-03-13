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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { provider, integration_id, test, date, duration_minutes = 30 } = body;

    // Fetch the integration
    const { data: integration, error: intError } = await supabase
      .from("calendar_integrations")
      .select("*")
      .eq("id", integration_id)
      .eq("user_id", user.id)
      .single();

    if (intError || !integration) {
      return new Response(JSON.stringify({ error: "Calendar integration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: any = {};

    if (provider === "google_calendar") {
      result = await handleGoogleCalendar(integration, { test, date, duration_minutes });
    } else if (provider === "cal_com") {
      result = await handleCalCom(integration, { test, date, duration_minutes });
    } else if (provider === "gohighlevel") {
      result = await handleGoHighLevel(integration, { test, date, duration_minutes });
    } else {
      return new Response(JSON.stringify({ error: "Unknown provider" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Calendar availability error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleGoogleCalendar(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const calendarId = integration.calendar_id || "primary";

  if (opts.test) {
    // Test: fetch calendar metadata
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}?key=${apiKey}`
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Google Calendar API error: ${err.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return { success: true, calendar: data.summary };
  }

  // Check availability: freebusy query
  const timeMin = opts.date || new Date().toISOString();
  const timeMax = new Date(new Date(timeMin).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Google Calendar API error: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return {
    success: true,
    events: data.items?.map((e: any) => ({
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
    })) || [],
  };
}

async function handleCalCom(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const eventTypeId = integration.calendar_id;

  if (opts.test) {
    const res = await fetch("https://api.cal.com/v1/me?apiKey=" + apiKey);
    if (!res.ok) {
      const errBody = await res.text();
      console.error("Cal.com test error:", errBody);
      throw new Error(`Cal.com API error: ${res.statusText} - ${errBody}`);
    }
    const data = await res.json();
    return { success: true, user: data.user?.name || data.user?.email };
  }

  // Check availability
  const dateFrom = opts.date || new Date().toISOString().split("T")[0];
  const dateTo = dateFrom;
  
  // Build URL with proper params - eventTypeId is optional for Cal.com v1
  let url = `https://api.cal.com/v1/availability?apiKey=${apiKey}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
  if (eventTypeId) {
    url += `&eventTypeId=${eventTypeId}`;
  }

  console.log(`Cal.com availability request: dateFrom=${dateFrom}, dateTo=${dateTo}, eventTypeId=${eventTypeId || "none"}`);

  const res = await fetch(url);
  if (!res.ok) {
    const errBody = await res.text();
    console.error("Cal.com availability error:", res.status, errBody);
    throw new Error(`Cal.com API error (${res.status}): ${errBody}`);
  }
  const data = await res.json();
  return { success: true, slots: data.slots || data.busy || [] };
}

async function handleGoHighLevel(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const calendarId = integration.calendar_id;

  if (opts.test) {
    const res = await fetch("https://rest.gohighlevel.com/v1/calendars/" + calendarId, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`GoHighLevel API error: ${res.statusText}`);
    }
    const data = await res.json();
    return { success: true, calendar: data.calendar?.name || data.name };
  }

  // Check free slots
  const startDate = opts.date ? new Date(opts.date).getTime() : Date.now();
  const endDate = startDate + 24 * 60 * 60 * 1000;
  const res = await fetch(
    `https://rest.gohighlevel.com/v1/appointments/slots?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    throw new Error(`GoHighLevel API error: ${res.statusText}`);
  }
  const data = await res.json();
  return { success: true, slots: data.slots || [] };
}
