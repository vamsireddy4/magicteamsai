import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Loader2, Trash2, CheckCircle2, XCircle, Plus } from "lucide-react";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

interface CalendarIntegration {
  id: string;
  user_id: string;
  provider: string;
  display_name: string;
  api_key: string | null;
  calendar_id: string | null;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
}

const PROVIDERS = [
  {
    id: "google_calendar",
    name: "Google Calendar",
    logo: googleCalendarLogo,
    description: "Check availability and book events on Google Calendar.",
    fields: [
      { key: "api_key", label: "Google API Key", placeholder: "AIza...", help: "Create an API key in Google Cloud Console with Calendar API enabled." },
      { key: "calendar_id", label: "Calendar ID", placeholder: "primary or your@email.com", help: "Use 'primary' for your main calendar, or find the Calendar ID in Google Calendar settings." },
    ],
  },
  {
    id: "cal_com",
    name: "Cal.com",
    logo: calcomLogo,
    description: "Check availability and create bookings via Cal.com.",
    fields: [
      { key: "api_key", label: "Cal.com API Key", placeholder: "cal_live_...", help: "Find your API key in Cal.com → Settings → Developer → API Keys." },
      { key: "calendar_id", label: "Event Type ID", placeholder: "123456", help: "The numeric event type ID from your Cal.com booking page URL." },
    ],
  },
  {
    id: "gohighlevel",
    name: "GoHighLevel",
    logo: gohighlevelLogo,
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
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const fetchData = async () => {
    if (!user) return;
    const { data } = await supabase.from("calendar_integrations").select("*").order("created_at");
    setIntegrations((data as CalendarIntegration[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const connectedProviders = integrations.map(i => i.provider);

  const handleConnect = async () => {
    if (!user || !selectedProvider) return;
    setSaving(true);

    const provider = PROVIDERS.find(p => p.id === selectedProvider);
    const { error } = await supabase.from("calendar_integrations").insert({
      user_id: user.id,
      provider: selectedProvider,
      display_name: provider?.name || selectedProvider,
      api_key: form.api_key || null,
      calendar_id: form.calendar_id || null,
    } as any);

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${provider?.name} connected` });
      setDialogOpen(false);
      setSelectedProvider(null);
      setForm({});
      fetchData();
    }
  };

  const handleDisconnect = async (id: string) => {
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
      toast({ title: "Connection failed", description: err.message || "Could not reach the calendar API.", variant: "destructive" });
    }
    setTesting(null);
  };

  const openConnectDialog = (providerId: string) => {
    setSelectedProvider(providerId);
    setForm({});
    setDialogOpen(true);
  };

  const currentProviderConfig = PROVIDERS.find(p => p.id === selectedProvider);

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
            {/* Connected calendars */}
            {integrations.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Connected Calendars</h2>
                {integrations.map(integration => {
                  const provider = PROVIDERS.find(p => p.id === integration.provider);
                  return (
                    <Card key={integration.id}>
                      <CardContent className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <img src={provider?.logo} alt={provider?.name} className="h-8 w-8 rounded object-contain" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{integration.display_name}</span>
                              <Badge variant={integration.is_active ? "default" : "secondary"}>
                                {integration.is_active ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Calendar: {integration.calendar_id || "Default"} · API Key: ••••{integration.api_key?.slice(-4) || "N/A"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestConnection(integration)}
                            disabled={testing === integration.id}
                          >
                            {testing === integration.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                            )}
                            Test
                          </Button>
                          <Switch
                            checked={integration.is_active}
                            onCheckedChange={() => toggleActive(integration.id, integration.is_active)}
                          />
                          <Button variant="ghost" size="icon" onClick={() => handleDisconnect(integration.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Available providers */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Available Providers</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {PROVIDERS.map(provider => {
                  const isConnected = connectedProviders.includes(provider.id);
                  return (
                    <Card key={provider.id} className={isConnected ? "opacity-60" : ""}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{provider.icon}</span>
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
                          disabled={isConnected}
                          onClick={() => openConnectDialog(provider.id)}
                        >
                          {isConnected ? "Connected" : "Connect"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Connect dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span>{currentProviderConfig?.icon}</span>
                Connect {currentProviderConfig?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
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
              <Button
                onClick={handleConnect}
                disabled={saving || !form.api_key}
                className="w-full"
              >
                {saving ? "Connecting..." : `Connect ${currentProviderConfig?.name}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
