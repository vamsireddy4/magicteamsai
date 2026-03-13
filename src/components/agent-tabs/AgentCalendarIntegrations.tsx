import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, Loader2, Trash2, CheckCircle2, Plus } from "lucide-react";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

interface CalendarIntegration {
  id: string; user_id: string; provider: string; display_name: string;
  api_key: string | null; calendar_id: string | null; is_active: boolean;
  config: Record<string, any>; created_at: string;
}

const PROVIDERS = [
  {
    id: "google_calendar", name: "Google Calendar", logo: googleCalendarLogo,
    description: "Check availability and book events.",
    fields: [
      { key: "api_key", label: "Google API Key", placeholder: "AIza...", help: "Create an API key with Calendar API enabled." },
      { key: "calendar_id", label: "Calendar ID", placeholder: "primary or your@email.com", help: "Use 'primary' for your main calendar." },
    ],
  },
  {
    id: "cal_com", name: "Cal.com", logo: calcomLogo,
    description: "Check availability and create bookings.",
    fields: [
      { key: "api_key", label: "Cal.com API Key", placeholder: "cal_live_...", help: "Settings → Developer → API Keys." },
      { key: "calendar_id", label: "Event Type ID", placeholder: "123456", help: "Event type ID from your booking page URL." },
    ],
  },
  {
    id: "gohighlevel", name: "GoHighLevel", logo: gohighlevelLogo,
    description: "Check availability and book appointments.",
    fields: [
      { key: "api_key", label: "GHL API Key", placeholder: "ghl-...", help: "Settings → Business Profile → API Key." },
      { key: "calendar_id", label: "Calendar ID", placeholder: "calendar-uuid", help: "Calendar ID from GHL settings." },
    ],
  },
];

interface Props {
  agentId: string;
  userId: string;
}

export default function AgentCalendarIntegrations({ agentId, userId }: Props) {
  const { toast } = useToast();
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const fetchData = async () => {
    const { data } = await supabase.from("calendar_integrations").select("*").eq("user_id", userId).order("created_at");
    setIntegrations((data as CalendarIntegration[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`cal-agent-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_integrations" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const handleConnect = async () => {
    if (!selectedProvider) return;
    setSaving(true);
    const provider = PROVIDERS.find(p => p.id === selectedProvider);
    const { error } = await supabase.from("calendar_integrations").insert({
      user_id: userId, provider: selectedProvider, display_name: provider?.name || selectedProvider,
      api_key: form.api_key || null, calendar_id: form.calendar_id || null,
    } as any);
    setSaving(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: `${provider?.name} connected` });
      setDialogOpen(false); setSelectedProvider(null); setForm({});
    }
  };

  const handleDisconnect = async (id: string) => {
    await supabase.from("calendar_integrations").delete().eq("id", id);
    toast({ title: "Calendar disconnected" }); fetchData();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("calendar_integrations").update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const handleTest = async (integration: CalendarIntegration) => {
    setTesting(integration.id);
    try {
      const { error } = await supabase.functions.invoke("check-calendar-availability", {
        body: { provider: integration.provider, integration_id: integration.id, test: true },
      });
      if (error) throw error;
      toast({ title: "Connection successful", description: `${integration.display_name} is working.` });
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message || "Could not reach the calendar API.", variant: "destructive" });
    }
    setTesting(null);
  };

  const connectedProviders = integrations.map(i => i.provider);
  const currentProviderConfig = PROVIDERS.find(p => p.id === selectedProvider);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Connect calendars so this agent can check availability and book appointments during calls.</p>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {integrations.length > 0 && (
            <div className="space-y-2">
              {integrations.map(integration => {
                const provider = PROVIDERS.find(p => p.id === integration.provider);
                return (
                  <Card key={integration.id}>
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <img src={provider?.logo} alt={provider?.name} className="h-7 w-7 rounded object-contain" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{integration.display_name}</span>
                            <Badge variant={integration.is_active ? "default" : "secondary"}>{integration.is_active ? "Active" : "Inactive"}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">Calendar: {integration.calendar_id || "Default"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleTest(integration)} disabled={testing === integration.id}>
                          {testing === integration.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}Test
                        </Button>
                        <Switch checked={integration.is_active} onCheckedChange={() => toggleActive(integration.id, integration.is_active)} />
                        <Button variant="ghost" size="icon" onClick={() => handleDisconnect(integration.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Calendar
          </Button>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {currentProviderConfig && <img src={currentProviderConfig.logo} alt="" className="h-6 w-6 rounded object-contain" />}
              Connect {currentProviderConfig?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {currentProviderConfig?.fields.map(field => (
              <div key={field.key} className="space-y-2">
                <Label>{field.label}</Label>
                <Input type={field.key === "api_key" ? "password" : "text"} placeholder={field.placeholder}
                  value={form[field.key] || ""} onChange={e => setForm({ ...form, [field.key]: e.target.value })} />
                <p className="text-xs text-muted-foreground">{field.help}</p>
              </div>
            ))}
            <Button onClick={handleConnect} disabled={saving || !form.api_key} className="w-full">
              {saving ? "Connecting..." : `Connect ${currentProviderConfig?.name}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
