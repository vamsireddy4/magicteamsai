import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { getErrorMessage, getFunctionUnavailableMessage, isEdgeFunctionUnavailable } from "@/lib/edge-functions";
import { CALENDAR_PROVIDER_META, getCachedLogoDataUrl } from "@/lib/provider-logos";
import { useLocation, useNavigate } from "react-router-dom";

interface CalendarIntegration {
  id: string;
  user_id: string;
  provider: string;
  display_name: string;
  logo_url?: string | null;
  api_key: string | null;
  calendar_id: string | null;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
}

interface CalComEventType {
  id: number;
  title: string;
  slug: string;
  length?: number;
}

const CAL_API_BASE = "https://api.cal.com/v2";
const CAL_API_VERSION = "2024-06-14";

const PROVIDERS = [
  {
    id: "google_calendar",
    name: CALENDAR_PROVIDER_META.google_calendar.name,
    logo: CALENDAR_PROVIDER_META.google_calendar.logo,
    description: "Check availability and book events on Google Calendar.",
    fields: [
      { key: "api_key", label: "Google API Key", placeholder: "AIza...", help: "Create an API key in Google Cloud Console with Calendar API enabled." },
      { key: "calendar_id", label: "Calendar ID", placeholder: "primary or your@email.com", help: "Use 'primary' for your main calendar, or find the Calendar ID in Google Calendar settings." },
    ],
  },
  {
    id: "cal_com",
    name: CALENDAR_PROVIDER_META.cal_com.name,
    logo: CALENDAR_PROVIDER_META.cal_com.logo,
    description: "Check availability and create bookings via Cal.com.",
    fields: [
      { key: "api_key", label: "Cal.com API Key (v2)", placeholder: "cal_live_...", help: "Create a v2 API key in Cal.com → Settings → Developer → API Keys." },
    ],
  },
  {
    id: "gohighlevel",
    name: CALENDAR_PROVIDER_META.gohighlevel.name,
    logo: CALENDAR_PROVIDER_META.gohighlevel.logo,
    description: "Check availability and book appointments via GoHighLevel.",
    fields: [
      { key: "api_key", label: "GHL API Key", placeholder: "ghl-...", help: "Find your API key in GoHighLevel → Settings → Business Profile → API Key." },
      { key: "calendar_id", label: "Calendar ID", placeholder: "calendar-uuid", help: "The calendar ID from GoHighLevel's calendar settings." },
    ],
  },
];

export default function CalendarIntegrations() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  // Cal.com auto-fetch state
  const [calFetching, setCalFetching] = useState(false);
  const [calEventTypes, setCalEventTypes] = useState<CalComEventType[]>([]);
  const [calUsername, setCalUsername] = useState("");
  const [calSelectedEventType, setCalSelectedEventType] = useState<string>("");
  const [calStep, setCalStep] = useState<"api_key" | "select_event" | "manual">("api_key");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const fetchCalComProfileAndEventType = async (apiKey: string) => {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CAL_API_VERSION,
    };

    const profileRes = await fetch(`${CAL_API_BASE}/me`, { headers });
    const profileJson = await profileRes.json();
    if (!profileRes.ok || profileJson?.status !== "success") {
      throw new Error(profileJson?.message || "Failed to fetch Cal.com profile");
    }

    const username = profileJson?.data?.username || "";
    const eventTypesUrl = username
      ? `${CAL_API_BASE}/event-types?username=${encodeURIComponent(username)}&sortCreatedAt=asc`
      : `${CAL_API_BASE}/event-types?sortCreatedAt=asc`;

    const eventTypesRes = await fetch(eventTypesUrl, { headers });
    const eventTypesJson = await eventTypesRes.json();
    if (!eventTypesRes.ok || eventTypesJson?.status !== "success") {
      throw new Error(eventTypesJson?.message || "Failed to fetch Cal.com event types");
    }

    const eventTypes = Array.isArray(eventTypesJson?.data) ? eventTypesJson.data : [];
    if (eventTypes.length === 0) {
      throw new Error("No event types found in this Cal.com account");
    }

    const firstEventType = eventTypes[0];
    return {
      username,
      eventTypeId: String(firstEventType.id),
      displayName: firstEventType.title || "Cal.com",
    };
  };

  const fetchData = async () => {
    if (!user) return;
    const { data } = await supabase.from("calendar_integrations").select("*").order("created_at");
    const rows = (data as CalendarIntegration[]) || [];
    setIntegrations(rows);
    setLoading(false);
    void backfillMissingLogos(rows);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('calendar-integrations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_integrations' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const params = new URLSearchParams(location.search);
    if (params.get("google_oauth") !== "1") return;
    const isPopup = params.get("popup") === "1";

    const finalizeGoogleOAuth = async () => {
      setGoogleConnecting(true);
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const session = sessionData.session;
        const providerToken = session?.provider_token;
        const providerRefreshToken = session?.provider_refresh_token;

        if (!providerToken) {
          throw new Error("Google OAuth completed, but no provider token was returned.");
        }

        const profileRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", {
          headers: {
            Authorization: `Bearer ${providerToken}`,
          },
        });

        if (!profileRes.ok) {
          const err = await profileRes.json().catch(() => ({}));
          throw new Error(err.error?.message || "Failed to read your Google Calendar profile.");
        }

        const primaryCalendar = await profileRes.json();

        const { data: existingIntegration, error: existingError } = await supabase
          .from("calendar_integrations")
          .select("id, refresh_token, config")
          .eq("user_id", user.id)
          .eq("provider", "google_calendar")
          .maybeSingle();

        if (existingError) throw existingError;

        const integrationPayload = {
          user_id: user.id,
          provider: "google_calendar",
          display_name: primaryCalendar.summary || primaryCalendar.id || "Google Calendar",
          calendar_id: primaryCalendar.id || "primary",
          access_token: providerToken,
          refresh_token: providerRefreshToken || existingIntegration?.refresh_token || null,
          token_expires_at: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
          api_key: null,
          config: {
            ...(existingIntegration?.config || {}),
            oauth_connected: true,
            calendar_summary: primaryCalendar.summary || null,
          },
        } as any;

        if (existingIntegration?.id) {
          const { error: updateError } = await supabase
            .from("calendar_integrations")
            .update(integrationPayload)
            .eq("id", existingIntegration.id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("calendar_integrations")
            .insert(integrationPayload);

          if (insertError) throw insertError;
        }

        toast({ title: "Google Calendar connected" });
        await fetchData();
        if (isPopup && window.opener) {
          window.opener.postMessage({ type: "google-calendar-connected" }, window.location.origin);
          window.close();
          return;
        }
      } catch (err: any) {
        if (isPopup && window.opener) {
          window.opener.postMessage({ type: "google-calendar-error", message: getErrorMessage(err) || "Could not complete Google OAuth." }, window.location.origin);
          window.close();
          return;
        }
        toast({
          title: "Google connection failed",
          description: getErrorMessage(err) || "Could not complete Google OAuth.",
          variant: "destructive",
        });
      } finally {
        setGoogleConnecting(false);
        if (!isPopup) {
          navigate(location.pathname, { replace: true });
        }
      }
    };

    void finalizeGoogleOAuth();
  }, [user, location.pathname, location.search, navigate]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "google-calendar-connected") {
        setGoogleConnecting(false);
        toast({ title: "Google Calendar connected" });
        void fetchData();
      }
      if (event.data?.type === "google-calendar-error") {
        setGoogleConnecting(false);
        toast({
          title: "Google connection failed",
          description: event.data?.message || "Could not complete Google OAuth.",
          variant: "destructive",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

  const connectedProviders = integrations.map(i => i.provider);

  const connectGoogleCalendar = async () => {
    setGoogleConnecting(true);
    const oauthOptions = {
      redirectTo: `${window.location.origin}/calendar-integrations?google_oauth=1&popup=1`,
      scopes: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events",
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    } as const;

    try {
      const { data, error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: oauthOptions,
      });

      if (error) throw error;
      if (data?.url) {
        const popup = window.open(data.url, "google-calendar-oauth", "width=520,height=720,resizable=yes,scrollbars=yes");
        if (!popup) {
          window.location.href = data.url;
          return;
        }
        return;
      }
      throw new Error("Google OAuth URL was not returned.");
    } catch (err: any) {
      const message = getErrorMessage(err) || "";
      const shouldFallbackToSignIn =
        message.toLowerCase().includes("manual linking is disabled") ||
        message.toLowerCase().includes("identity linking");

      if (shouldFallbackToSignIn) {
        try {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: oauthOptions,
          });
          if (error) throw error;
          if (data?.url) {
            const popup = window.open(data.url, "google-calendar-oauth", "width=520,height=720,resizable=yes,scrollbars=yes");
            if (!popup) {
              window.location.href = data.url;
              return;
            }
            return;
          }
          throw new Error("Google OAuth URL was not returned.");
        } catch (fallbackErr: any) {
          setGoogleConnecting(false);
          toast({
            title: "Google connection failed",
            description: getErrorMessage(fallbackErr) || "Could not start Google OAuth.",
            variant: "destructive",
          });
          return;
        }
      }

      setGoogleConnecting(false);
      toast({
        title: "Google connection failed",
        description: message || "Could not start Google OAuth.",
        variant: "destructive",
      });
    }
  };

  const handleCalComFetch = async () => {
    if (!form.api_key) return;
    setCalFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-calendar-availability", {
        body: { provider: "cal_com", fetch_event_types: true, api_key: form.api_key },
      });
      if (error) throw error;
      if (!data.success) throw new Error("Failed to fetch Cal.com data");

      setCalUsername(data.username || "");
      setCalEventTypes(data.event_types || []);

      if (data.event_types?.length === 1) {
        // Auto-select the only event type and save immediately
        await saveCalComIntegration(form.api_key, data.username, data.event_types[0].id.toString(), data.user_name);
      } else if (data.event_types?.length > 1) {
        setCalStep("select_event");
      } else {
        toast({ title: "No event types found", description: "Create an event type in Cal.com first.", variant: "destructive" });
      }
    } catch (err: any) {
      if (isEdgeFunctionUnavailable(err)) {
        try {
          const calComData = await fetchCalComProfileAndEventType(form.api_key);
          await saveCalComIntegration(
            form.api_key,
            calComData.username,
            calComData.eventTypeId,
            calComData.displayName
          );
        } catch (clientErr: any) {
          toast({
            title: "Failed to connect",
            description: getErrorMessage(clientErr) || "Could not fetch Cal.com username and event type ID.",
            variant: "destructive"
          });
        }
        setCalFetching(false);
        return;
      } else {
        toast({
          title: "Failed to connect",
          description: getErrorMessage(err) || "Invalid API key or Cal.com error.",
          variant: "destructive"
        });
      }
    }
    setCalFetching(false);
  };

  const saveCalComIntegration = async (apiKey: string, username: string, eventTypeId: string, displayName?: string) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("calendar_integrations").insert({
      user_id: user.id,
      provider: "cal_com",
      display_name: displayName || "Cal.com",
      logo_url: await getCachedLogoDataUrl(CALENDAR_PROVIDER_META.cal_com.logo),
      api_key: apiKey,
      calendar_id: eventTypeId,
      config: { username },
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cal.com connected successfully" });
      resetDialog();
      fetchData();
    }
  };

  const handleCalComSelectAndSave = async () => {
    if (!calSelectedEventType || !form.api_key) return;
    const et = calEventTypes.find(e => e.id.toString() === calSelectedEventType);
    await saveCalComIntegration(form.api_key, calUsername, calSelectedEventType, et?.title || "Cal.com");
  };

  const handleManualCalComSave = async () => {
    if (!form.api_key || !form.calendar_id) {
      toast({ title: "Missing fields", description: "API key and Event Type ID are required.", variant: "destructive" });
      return;
    }
    await saveCalComIntegration(
      form.api_key,
      form.username || "",
      form.calendar_id,
      form.username ? `Cal.com (${form.username})` : "Cal.com"
    );
  };

  const handleConnect = async () => {
    if (!user || !selectedProvider) return;

    // Cal.com uses the auto-fetch flow
    if (selectedProvider === "cal_com") {
      await handleCalComFetch();
      return;
    }

    setSaving(true);
    const provider = PROVIDERS.find(p => p.id === selectedProvider);

    const { error } = await supabase.from("calendar_integrations").insert({
      user_id: user.id,
      provider: selectedProvider,
      display_name: provider?.name || selectedProvider,
      logo_url: await getCachedLogoDataUrl(CALENDAR_PROVIDER_META[selectedProvider].logo),
      api_key: form.api_key || null,
      calendar_id: form.calendar_id || null,
      config: {},
    } as any);

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${provider?.name} connected` });
      resetDialog();
      fetchData();
    }
  };

  const resetDialog = () => {
    setDialogOpen(false);
    setSelectedProvider(null);
    setForm({});
    setCalStep("api_key");
    setCalEventTypes([]);
    setCalUsername("");
    setCalSelectedEventType("");
  };

  const handleDisconnect = async (id: string) => {
    const { error: detachError } = await supabase
      .from("appointment_tools" as any)
      .update({ calendar_integration_id: null } as any)
      .eq("calendar_integration_id", id);

    if (detachError) {
      toast({ title: "Error", description: detachError.message, variant: "destructive" });
      return;
    }

    const { error } = await supabase.from("calendar_integrations").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Calendar disconnected" });
      fetchData();
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("calendar_integrations").update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const handleTestConnection = async (integration: CalendarIntegration) => {
    setTesting(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke("check-calendar-availability", {
        body: { provider: integration.provider, integration_id: integration.id, test: true },
      });
      if (error) throw error;
      toast({ title: "Connection successful", description: `${integration.display_name} is working correctly.` });
    } catch (err: any) {
      toast({
        title: "Connection failed",
        description: isEdgeFunctionUnavailable(err)
          ? getFunctionUnavailableMessage("Calendar connection test")
          : getErrorMessage(err) || "Could not reach the calendar API.",
        variant: "destructive"
      });
    }
    setTesting(null);
  };

  const openConnectDialog = (providerId: string) => {
    if (providerId === "google_calendar") {
      void connectGoogleCalendar();
      return;
    }
    setSelectedProvider(providerId);
    setForm({});
    setCalStep("api_key");
    setCalEventTypes([]);
    setCalUsername("");
    setCalSelectedEventType("");
    setDialogOpen(true);
  };

  const currentProviderConfig = PROVIDERS.find(p => p.id === selectedProvider);
  const isCalCom = selectedProvider === "cal_com";

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendar Integrations</h1>
          <p className="text-muted-foreground mt-1">
            Connect your calendars so AI agents can check availability and book appointments during calls.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {integrations.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Connected Calendars</h2>
                {integrations.map(integration => {
                  const provider = PROVIDERS.find(p => p.id === integration.provider);
                  const isExpanded = expandedCard === integration.id;
                  return (
                    <Card
                      key={integration.id}
                      className="cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => setExpandedCard(isExpanded ? null : integration.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <img src={integration.logo_url || provider?.logo} alt={provider?.name} className="h-8 w-8 rounded object-contain" />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{integration.display_name}</span>
                                <Badge variant={integration.is_active ? "default" : "secondary"}>
                                  {integration.is_active ? "Active" : "Inactive"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <Switch
                              checked={integration.is_active}
                              onCheckedChange={(e) => { e; toggleActive(integration.id, integration.is_active); }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDisconnect(integration.id); }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
                            {integration.provider === "cal_com" && (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Username</span>
                                  <span className="font-medium">{(integration.config as any)?.username || "N/A"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Event Type ID</span>
                                  <span className="font-medium">{integration.calendar_id || "N/A"}</span>
                                </div>
                              </>
                            )}
                            {integration.provider !== "cal_com" && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Calendar ID</span>
                                <span className="font-medium">{integration.calendar_id || "Default"}</span>
                              </div>
                            )}
                            {integration.provider === "google_calendar" ? (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Auth</span>
                                <span className="font-medium">{integration.refresh_token ? "OAuth connected" : "OAuth access only"}</span>
                              </div>
                            ) : (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">API Key</span>
                                <span className="font-medium">••••{integration.api_key?.slice(-4) || "N/A"}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Available Providers</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PROVIDERS.map(provider => {
                  const isConnected = connectedProviders.includes(provider.id);
                  return (
                    <Card key={provider.id} className={isConnected ? "opacity-60" : ""}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <img src={provider.logo} alt={provider.name} className="h-10 w-10 rounded object-contain" />
                          <div>
                            <CardTitle className="text-base">{provider.name}</CardTitle>
                            {isConnected && (
                              <Badge variant="outline" className="mt-1">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">{provider.description}</p>
                        <Button
                          className="w-full"
                          variant={isConnected ? "outline" : "default"}
                          disabled={isConnected || (provider.id === "google_calendar" && googleConnecting)}
                          onClick={() => openConnectDialog(provider.id)}
                        >
                          {isConnected ? "Connected" : provider.id === "google_calendar" && googleConnecting ? "Connecting..." : "Connect"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetDialog(); else setDialogOpen(true); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {currentProviderConfig && <img src={currentProviderConfig.logo} alt={currentProviderConfig.name} className="h-6 w-6 rounded object-contain" />}
                Connect {currentProviderConfig?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {isCalCom ? (
                calStep === "api_key" ? (
                  <>
                    <div className="space-y-2">
                      <Label>Cal.com API Key (v2)</Label>
                      <Input
                        type="password"
                        placeholder="cal_live_..."
                        value={form.api_key || ""}
                        onChange={e => setForm({ ...form, api_key: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Create a v2 API key in Cal.com → Settings → Developer → API Keys.</p>
                    </div>
                    <Button onClick={handleConnect} disabled={calFetching || !form.api_key} className="w-full">
                      {calFetching ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" />Fetching event types...</>
                      ) : (
                        "Connect Cal.com"
                      )}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setCalStep("manual")} className="w-full">
                      Enter details manually
                    </Button>
                  </>
                ) : calStep === "select_event" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connected as <span className="font-medium text-foreground">{calUsername}</span>. Select an event type:
                    </p>
                    <Select value={calSelectedEventType} onValueChange={setCalSelectedEventType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose an event type" />
                      </SelectTrigger>
                      <SelectContent>
                        {calEventTypes.map(et => (
                          <SelectItem key={et.id} value={et.id.toString()}>
                            {et.title} {et.length ? `(${et.length} min)` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleCalComSelectAndSave} disabled={saving || !calSelectedEventType} className="w-full">
                      {saving ? "Saving..." : "Save & Connect"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setCalStep("manual")} className="w-full">
                      Enter event type manually
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Cal.com API Key (v2)</Label>
                      <Input
                        type="password"
                        placeholder="cal_live_..."
                        value={form.api_key || ""}
                        onChange={e => setForm({ ...form, api_key: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input
                        placeholder="your-calcom-username"
                        value={form.username || ""}
                        onChange={e => setForm({ ...form, username: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Optional, but useful for display and future availability checks.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Event Type ID</Label>
                      <Input
                        placeholder="123456"
                        value={form.calendar_id || ""}
                        onChange={e => setForm({ ...form, calendar_id: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Use the numeric Cal.com event type ID you want this app to book against.</p>
                    </div>
                    <Button onClick={handleManualCalComSave} disabled={saving || !form.api_key || !form.calendar_id} className="w-full">
                      {saving ? "Saving..." : "Save & Connect"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setCalStep("api_key")} className="w-full">
                      Back to automatic lookup
                    </Button>
                  </>
                )
              ) : (
                <>
                  {currentProviderConfig?.fields.map(field => (
                    <div key={field.key} className="space-y-2">
                      <Label>{field.label}</Label>
                      <Input
                        type={field.key === "api_key" ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={form[field.key] || ""}
                        onChange={e => setForm({ ...form, [field.key]: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">{field.help}</p>
                    </div>
                  ))}
                  <Button onClick={handleConnect} disabled={saving || !form.api_key} className="w-full">
                    {saving ? "Connecting..." : `Connect ${currentProviderConfig?.name}`}
                  </Button>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
  const backfillMissingLogos = async (rows: CalendarIntegration[]) => {
    const missing = rows.filter((row) => !row.logo_url && CALENDAR_PROVIDER_META[row.provider]);
    if (missing.length === 0) return;

    await Promise.all(
      missing.map(async (row) => {
        const meta = CALENDAR_PROVIDER_META[row.provider];
        const logoUrl = await getCachedLogoDataUrl(meta.logo);
        await supabase.from("calendar_integrations").update({ logo_url: logoUrl } as any).eq("id", row.id);
      })
    );
  };
