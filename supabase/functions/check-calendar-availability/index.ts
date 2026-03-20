import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ultravox-tool-key",
};

// Initialize once to reuse across requests
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseKey);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    const ultravoxToolKey = req.headers.get("x-ultravox-tool-key");
    const isTrustedUltravoxTool = !!ultravoxToolKey && !!ultravoxApiKey && ultravoxToolKey === ultravoxApiKey;

    const token = authHeader?.replace("Bearer ", "") || "";
    const isServiceRole = !!token && token === supabaseKey;

    let userId: string | null = null;
    if (!isServiceRole && !isTrustedUltravoxTool) {
      if (!token) {
        return new Response(JSON.stringify({ error: "No authorization header" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    const body = await req.json();
    const { provider, integration_id, test, date, duration_minutes = 30, fetch_event_types, api_key } = body;

    // Direct Cal.com API key lookup (no integration record needed)
    if (provider === "cal_com" && fetch_event_types && api_key) {
      const result = await handleCalComDirect(api_key, { fetch_event_types: true });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up integration
    let query = supabase.from("calendar_integrations").select("*").eq("id", integration_id);
    if (!isServiceRole && !isTrustedUltravoxTool && userId) {
      query = query.eq("user_id", userId);
    }
    const { data: integration, error: intError } = await query.single();

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
  const { accessToken, querySuffix, headers } = await getGoogleAuthHeaders(integration);
  const calendarId = integration.calendar_id || "primary";

  if (opts.test) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}${querySuffix}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Calendar API error: ${err.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return { success: true, calendar: data.summary };
  }

  const timeMin = opts.date || new Date().toISOString();
  const timeMax = new Date(new Date(timeMin).getTime() + 24 * 60 * 60 * 1000).toISOString();

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime${querySuffix ? `&${querySuffix.slice(1)}` : ""}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
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

async function getGoogleAuthHeaders(integration: any) {
  const apiKey = integration.api_key;
  if (apiKey?.startsWith("AIza")) {
    return {
      accessToken: apiKey,
      querySuffix: `?key=${apiKey}`,
      headers: {} as Record<string, string>,
    };
  }

  const token = await ensureGoogleAccessToken(integration);
  return {
    accessToken: token,
    querySuffix: "",
    headers: {
      Authorization: `Bearer ${token}`,
    } as Record<string, string>,
  };
}

async function ensureGoogleAccessToken(integration: any) {
  const accessToken = integration.access_token || integration.api_key;
  const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  const hasFreshAccessToken = accessToken && expiresAt > Date.now() + 60_000;

  if (hasFreshAccessToken) {
    return accessToken;
  }

  const refreshToken = integration.refresh_token;
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    if (accessToken) return accessToken;
    throw new Error("Google Calendar OAuth is not fully configured.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || tokenJson.error || "Failed to refresh Google Calendar token.");
  }

  const nextExpiresAt = tokenJson.expires_in
    ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString()
    : null;

  await supabase
    .from("calendar_integrations")
    .update({
      access_token: tokenJson.access_token,
      token_expires_at: nextExpiresAt,
    })
    .eq("id", integration.id);

  return tokenJson.access_token as string;
}

// Cal.com v2 API
const CAL_V2_HEADERS = {
  "Content-Type": "application/json",
  "cal-api-version": "2024-08-13",
};

async function handleCalComDirect(apiKey: string, opts: any) {
  const authHeaders = {
    ...CAL_V2_HEADERS,
    Authorization: `Bearer ${apiKey}`,
  };

  const meRes = await fetch("https://api.cal.com/v2/me", { headers: authHeaders });
  if (!meRes.ok) {
    const errBody = await meRes.text();
    console.error("Cal.com v2 /me error:", meRes.status, errBody);
    throw new Error(`Cal.com API error (${meRes.status}): ${errBody}`);
  }
  const meData = await meRes.json();
  const username = meData.data?.username || meData.data?.name || "";

  const etHeaders = {
    "Content-Type": "application/json",
    "cal-api-version": "2024-06-14",
    Authorization: `Bearer ${apiKey}`,
  };
  const etRes = await fetch("https://api.cal.com/v2/event-types", { headers: etHeaders });
  if (!etRes.ok) {
    const errBody = await etRes.text();
    console.error("Cal.com v2 /event-types error:", etRes.status, errBody);
    throw new Error(`Cal.com API error (${etRes.status}): ${errBody}`);
  }
  const etData = await etRes.json();
  const eventTypes = (etData.data?.eventTypes || etData.data || []).map((et: any) => ({
    id: et.id,
    title: et.title || et.slug,
    slug: et.slug,
    length: et.lengthInMinutes || et.length,
  }));

  return {
    success: true,
    username,
    user_name: meData.data?.name || meData.data?.email || "Connected",
    event_types: eventTypes,
  };
}

async function handleCalCom(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const eventTypeId = integration.calendar_id;
  const config = integration.config || {};
  const username = config.username || "";

  const authHeaders = {
    ...CAL_V2_HEADERS,
    Authorization: `Bearer ${apiKey}`,
  };

  if (opts.test) {
    const res = await fetch("https://api.cal.com/v2/me", { headers: authHeaders });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Cal.com API error (${res.status}): ${errBody}`);
    }
    const data = await res.json();
    return { success: true, user: data.data?.name || data.data?.email || "Connected" };
  }

  const startDate = opts.date || new Date().toISOString().split("T")[0];
  const endDateObj = new Date(startDate);
  endDateObj.setDate(endDateObj.getDate() + 7);
  const endDate = endDateObj.toISOString().split("T")[0];

  const params = new URLSearchParams({
    startTime: `${startDate}T00:00:00.000Z`,
    endTime: `${endDate}T23:59:59.000Z`,
  });

  if (eventTypeId && !isNaN(Number(eventTypeId))) {
    params.set("eventTypeId", eventTypeId);
  } else if (eventTypeId && username) {
    params.set("eventTypeSlug", eventTypeId);
    params.set("usernameList", username);
  } else {
    throw new Error("Cal.com requires a valid Event Type ID (numeric) to check availability.");
  }

  const url = `https://api.cal.com/v2/slots/available?${params.toString()}`;
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Cal.com API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const slotsObj = data.data?.slots || data.slots || {};
  const flatSlots: any[] = [];
  for (const [dateKey, daySlots] of Object.entries(slotsObj)) {
    if (Array.isArray(daySlots)) {
      for (const slot of daySlots) {
        flatSlots.push({ date: dateKey, time: (slot as any).time || (slot as any).start });
      }
    }
  }

  return { success: true, slots: flatSlots };
}

async function handleGoHighLevel(integration: any, opts: any) {
  const apiKey = integration.api_key;
  const calendarId = integration.calendar_id;

  if (!apiKey || !calendarId) {
    throw new Error("GoHighLevel requires both an API Key and a Calendar ID.");
  }

  const isV2 = apiKey.length > 50 || apiKey.startsWith("ghl-v2-");

  if (isV2) {
    const headers = { "Authorization": `Bearer ${apiKey}`, "Version": "2021-04-15" };
    if (opts.test) {
      const res = await fetch(`https://services.leadconnectorhq.com/calendars/${calendarId}`, { headers });
      if (!res.ok) throw new Error(`GHL V2 API error: ${res.statusText}`);
      const data = await res.json();
      return { success: true, calendar: data.calendar?.name || data.name };
    }
    const startDate = opts.date ? new Date(opts.date).getTime() : Date.now();
    const endDate = startDate + 24 * 60 * 60 * 1000;
    const url = `https://services.leadconnectorhq.com/calendars/slots?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GHL V2 slots error: ${res.statusText}`);
    const data = await res.json();
    return { success: true, slots: data.slots || [] };
  } else {
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (opts.test) {
      const res = await fetch("https://rest.gohighlevel.com/v1/calendars/" + calendarId, { headers });
      if (!res.ok) throw new Error(`GHL V1 API error: ${res.statusText}`);
      const data = await res.json();
      return { success: true, calendar: data.calendar?.name || data.name };
    }
    const startDate = opts.date ? new Date(opts.date).getTime() : Date.now();
    const endDate = startDate + 24 * 60 * 60 * 1000;
    const res = await fetch(`https://rest.gohighlevel.com/v1/appointments/slots?calendarId=${calendarId}&startDate=${startDate}&endDate=${endDate}`, { headers });
    if (!res.ok) throw new Error(`GHL V1 slots error: ${res.statusText}`);
    const data = await res.json();
    return { success: true, slots: data.slots || [] };
  }
}
