import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Phone, Trash2, Settings, Eye, EyeOff, CheckCircle2, Pencil, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getCachedLogoDataUrl, PHONE_PROVIDER_META } from "@/lib/provider-logos";

interface PhoneConfig {
  id: string;
  user_id: string;
  provider: string;
  logo_url?: string | null;
  phone_number: string;
  inbound_agent_id: string | null;
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  telnyx_api_key: string | null;
  telnyx_connection_id: string | null;
  friendly_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  is_active: boolean;
}

const PROVIDERS = [
  {
    id: "twilio",
    name: PHONE_PROVIDER_META.twilio.name,
    logo: PHONE_PROVIDER_META.twilio.logo,
    description: "Industry-standard cloud communications platform for voice calls.",
    fields: [
      { key: "twilio_account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", type: "text", help: "Find this in your Twilio Console dashboard." },
      { key: "twilio_auth_token", label: "Auth Token", placeholder: "Your Twilio auth token", type: "password", help: "Your auth token is also in the Twilio Console." },
      { key: "phone_number", label: "Phone Number", placeholder: "+15551234567", type: "text", help: "Your Twilio phone number in E.164 format." },
    ],
  },
  {
    id: "telnyx",
    name: PHONE_PROVIDER_META.telnyx.name,
    logo: PHONE_PROVIDER_META.telnyx.logo,
    description: "Global carrier-grade voice platform with competitive pricing.",
    fields: [
      { key: "telnyx_api_key", label: "API Key", placeholder: "KEY...", type: "password", help: "Find your API key in the Telnyx Mission Control Portal under Auth." },
      { key: "telnyx_connection_id", label: "Connection ID", placeholder: "123456789...", type: "text", help: "The SIP Connection ID from Telnyx Mission Control → SIP Connections." },
      { key: "phone_number", label: "Phone Number", placeholder: "+15551234567", type: "text", help: "Your Telnyx phone number in E.164 format." },
    ],
  },
];

export default function PhoneConfig() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<PhoneConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PhoneConfig | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [inboundDialogOpen, setInboundDialogOpen] = useState(false);
  const [editingInboundConfig, setEditingInboundConfig] = useState<PhoneConfig | null>(null);
  const [selectedInboundAgentId, setSelectedInboundAgentId] = useState<string>("");
  const [savingInbound, setSavingInbound] = useState(false);

  const getSavedProviderCredentials = (providerId: string) => {
    const existingConfigs = configs.filter((config) => config.provider === providerId);
    if (existingConfigs.length === 0) return null;

    if (providerId === "twilio") {
      const existing = existingConfigs.find((config) => config.twilio_account_sid && config.twilio_auth_token);
      if (!existing) return null;
      return {
        twilio_account_sid: existing.twilio_account_sid || "",
        twilio_auth_token: existing.twilio_auth_token || "",
      };
    }

    if (providerId === "telnyx") {
      const existing = existingConfigs.find((config) => config.telnyx_api_key && config.telnyx_connection_id);
      if (!existing) return null;
      return {
        telnyx_api_key: existing.telnyx_api_key || "",
        telnyx_connection_id: existing.telnyx_connection_id || "",
      };
    }

    return null;
  };

  const backfillMissingLogos = async (rows: PhoneConfig[]) => {
    const missing = rows.filter((row) => !row.logo_url && PHONE_PROVIDER_META[row.provider]);
    if (missing.length === 0) return;

    await Promise.all(
      missing.map(async (row) => {
        const meta = PHONE_PROVIDER_META[row.provider];
        const logoUrl = await getCachedLogoDataUrl(meta.logo);
        await supabase.from("phone_configs").update({ logo_url: logoUrl } as any).eq("id", row.id);
      })
    );
  };

  const fetchConfigs = async () => {
    if (!user) return;
    const [{ data }, { data: agentRows }] = await Promise.all([
      supabase.from("phone_configs").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name, is_active").eq("is_active", true).order("name"),
    ]);
    const rows = (data as PhoneConfig[]) || [];
    setConfigs(rows);
    setAgents((agentRows as AgentRow[]) || []);
    setLoading(false);
    void backfillMissingLogos(rows);
  };

  useEffect(() => {
    fetchConfigs();
    const channel = supabase
      .channel('phone-configs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'phone_configs' }, () => fetchConfigs())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const openConnectDialog = (providerId: string, config?: PhoneConfig) => {
    setSelectedProvider(providerId);
    setShowSecrets({});
    if (config) {
      setEditingConfig(config);
      const formData: Record<string, string> = { phone_number: config.phone_number };
      if (providerId === "twilio") {
        formData.twilio_account_sid = config.twilio_account_sid || "";
        formData.twilio_auth_token = config.twilio_auth_token || "";
      } else if (providerId === "telnyx") {
        formData.telnyx_api_key = config.telnyx_api_key || "";
        formData.telnyx_connection_id = config.telnyx_connection_id || "";
      }
      setForm(formData);
    } else {
      setEditingConfig(null);
      setForm({ ...(getSavedProviderCredentials(providerId) || {}) });
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedProvider) return;
    setSaving(true);

    const data: Record<string, any> = {
      user_id: user.id,
      provider: selectedProvider,
      logo_url: await getCachedLogoDataUrl(PHONE_PROVIDER_META[selectedProvider].logo),
      phone_number: form.phone_number,
    };

    const savedProviderCredentials = getSavedProviderCredentials(selectedProvider);

    if (selectedProvider === "twilio") {
      data.twilio_account_sid = form.twilio_account_sid || savedProviderCredentials?.twilio_account_sid || null;
      data.twilio_auth_token = form.twilio_auth_token || savedProviderCredentials?.twilio_auth_token || null;
    } else if (selectedProvider === "telnyx") {
      data.telnyx_api_key = form.telnyx_api_key || savedProviderCredentials?.telnyx_api_key || null;
      data.telnyx_connection_id = form.telnyx_connection_id || savedProviderCredentials?.telnyx_connection_id || null;
    }

    if (selectedProvider === "twilio" && (!data.twilio_account_sid || !data.twilio_auth_token)) {
      setSaving(false);
      toast({ title: "Missing credentials", description: "Save your Twilio Account SID and Auth Token once before adding more numbers.", variant: "destructive" });
      return;
    }

    if (selectedProvider === "telnyx" && (!data.telnyx_api_key || !data.telnyx_connection_id)) {
      setSaving(false);
      toast({ title: "Missing credentials", description: "Save your Telnyx API key and Connection ID once before adding more numbers.", variant: "destructive" });
      return;
    }

    let error;
    if (editingConfig) {
      ({ error } = await supabase.from("phone_configs").update(data as any).eq("id", editingConfig.id));
    } else {
      ({ error } = await supabase.from("phone_configs").insert(data as any));
    }

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const provider = PROVIDERS.find(p => p.id === selectedProvider);
      toast({ title: editingConfig ? `${provider?.name} config updated` : `${provider?.name} phone number added successfully` });
      setDialogOpen(false);
      setSelectedProvider(null);
      setEditingConfig(null);
      setForm({});
      fetchConfigs();
    }
  };

  const deleteConfig = async (id: string) => {
    await Promise.all([
      supabase.from("campaign_phone_configs").delete().eq("phone_config_id", id),
      supabase.from("campaigns").update({ phone_config_id: null } as any).eq("phone_config_id", id),
      supabase.from("agents").update({ phone_number_id: null } as any).eq("phone_number_id", id),
    ]);
    await supabase.from("phone_configs").delete().eq("id", id);
    toast({ title: "Configuration deleted" });
    fetchConfigs();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("phone_configs").update({ is_active: !current } as any).eq("id", id);
    fetchConfigs();
  };

  const currentProviderConfig = PROVIDERS.find(p => p.id === selectedProvider);
  const savedCredentials = selectedProvider ? getSavedProviderCredentials(selectedProvider) : null;
  const reusingSavedCredentials = Boolean(savedCredentials && !editingConfig);
  const getAgentName = (agentId: string | null) =>
    agentId ? agents.find((agent) => agent.id === agentId)?.name || "Unknown agent" : null;

  const openInboundDialog = (config: PhoneConfig) => {
    setEditingInboundConfig(config);
    setSelectedInboundAgentId(config.inbound_agent_id || "");
    setInboundDialogOpen(true);
  };

  const saveInboundAgent = async () => {
    if (!editingInboundConfig) return;
    setSavingInbound(true);
    const { error } = await supabase
      .from("phone_configs")
      .update({ inbound_agent_id: selectedInboundAgentId || null } as any)
      .eq("id", editingInboundConfig.id);
    setSavingInbound(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: selectedInboundAgentId ? "Inbound bot updated" : "Inbound bot removed",
      description: selectedInboundAgentId
        ? `${getAgentName(selectedInboundAgentId) || "Selected agent"} will answer calls to ${editingInboundConfig.phone_number}.`
        : "This number will no longer route to a dedicated inbound bot.",
    });
    setInboundDialogOpen(false);
    setEditingInboundConfig(null);
    setSelectedInboundAgentId("");
    fetchConfigs();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Phone Configuration</h1>
          <p className="text-muted-foreground mt-1">Connect your telephony provider to enable phone calls.</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-6 h-20" /></Card>
            ))}
          </div>
        ) : (
          <>
            {/* Connected numbers */}
            {configs.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Connected Numbers</h2>
                {configs.map((config) => {
                  const provider = PROVIDERS.find(p => p.id === config.provider);
                  return (
                    <Card key={config.id}>
                      <CardContent className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-3">
                          <img src={config.logo_url || provider?.logo} alt={provider?.name} className="h-8 w-8 rounded object-contain" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{config.phone_number}</p>
                              <Badge variant="outline" className="text-xs">{provider?.name}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {config.provider === "twilio" && config.twilio_account_sid
                                ? `SID: ${config.twilio_account_sid.slice(0, 8)}...`
                                : config.provider === "telnyx" && config.telnyx_connection_id
                                ? `Connection: ${config.telnyx_connection_id.slice(0, 8)}...`
                                : ""}
                            </p>
                            {config.inbound_agent_id && (
                              <p className="text-xs text-muted-foreground">
                                Inbound bot: {getAgentName(config.inbound_agent_id)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Open phone actions">
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => toggleActive(config.id, config.is_active)}>
                                <Badge variant={config.is_active ? "default" : "secondary"} className="mr-2">
                                  {config.is_active ? "Active" : "Inactive"}
                                </Badge>
                                {config.is_active ? "Mark Inactive" : "Mark Active"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openConnectDialog(config.provider, config)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openInboundDialog(config)}>
                                <Settings className="mr-2 h-4 w-4" />
                                Settings
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => deleteConfig(config.id)} className="text-destructive focus:text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Provider cards */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Available Providers</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {PROVIDERS.map((provider) => (
                  <Card key={provider.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-3">
                        <img src={provider.logo} alt={provider.name} className="h-10 w-10 rounded object-contain" />
                        <CardTitle className="text-base">{provider.name}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">{provider.description}</p>
                      <Button className="w-full" onClick={() => openConnectDialog(provider.id)}>
                        Add {provider.name} Number
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Connect dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {currentProviderConfig && <img src={currentProviderConfig.logo} alt={currentProviderConfig.name} className="h-6 w-6 rounded object-contain" />}
                {editingConfig ? "Edit" : "Connect"} {currentProviderConfig?.name}
              </DialogTitle>
              <DialogDescription>
                {reusingSavedCredentials
                  ? `Using your saved ${currentProviderConfig?.name} credentials. Enter a phone number to connect another line.`
                  : `Enter your ${currentProviderConfig?.name} credentials to enable phone calls.`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {reusingSavedCredentials && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Saved provider credentials found. You only need to enter the new phone number.
                </div>
              )}
              {currentProviderConfig?.fields.map((field) => (
                reusingSavedCredentials && field.key !== "phone_number" ? null : (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.type === "password" ? (
                    <div className="relative">
                      <Input
                        id={field.key}
                        type={showSecrets[field.key] ? "text" : "password"}
                        value={form[field.key] || ""}
                        onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        required={!reusingSavedCredentials}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowSecrets({ ...showSecrets, [field.key]: !showSecrets[field.key] })}
                      >
                        {showSecrets[field.key] ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                    </div>
                  ) : (
                    <Input
                      id={field.key}
                      value={form[field.key] || ""}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      required
                    />
                  )}
                  <p className="text-xs text-muted-foreground">{field.help}</p>
                </div>
                )
              ))}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving..." : editingConfig ? `Update ${currentProviderConfig?.name}` : `Connect ${currentProviderConfig?.name}`}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={inboundDialogOpen}
          onOpenChange={(open) => {
            setInboundDialogOpen(open);
            if (!open) {
              setEditingInboundConfig(null);
              setSelectedInboundAgentId("");
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Inbound</DialogTitle>
              <DialogDescription>
                Choose which AI agent should answer inbound calls for {editingInboundConfig?.phone_number || "this number"}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Inbound Agent</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedInboundAgentId}
                  onChange={(e) => setSelectedInboundAgentId(e.target.value)}
                >
                  <option value="">No dedicated inbound bot</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <Button onClick={saveInboundAgent} disabled={savingInbound}>
                  {savingInbound ? "Saving..." : "Save Inbound"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setInboundDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
