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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Phone, Trash2, Settings, Eye, EyeOff, CheckCircle2, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import twilioLogo from "@/assets/twilio-logo.png";
import telnyxLogo from "@/assets/telnyx-logo.png";

interface PhoneConfig {
  id: string;
  user_id: string;
  provider: string;
  phone_number: string;
  twilio_account_sid: string | null;
  twilio_auth_token: string | null;
  telnyx_api_key: string | null;
  telnyx_connection_id: string | null;
  friendly_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const PROVIDERS = [
  {
    id: "twilio",
    name: "Twilio",
    logo: twilioLogo,
    description: "Industry-standard cloud communications platform for voice calls.",
    fields: [
      { key: "twilio_account_sid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", type: "text", help: "Find this in your Twilio Console dashboard." },
      { key: "twilio_auth_token", label: "Auth Token", placeholder: "Your Twilio auth token", type: "password", help: "Your auth token is also in the Twilio Console." },
      { key: "phone_number", label: "Phone Number", placeholder: "+15551234567", type: "text", help: "Your Twilio phone number in E.164 format." },
    ],
  },
  {
    id: "telnyx",
    name: "Telnyx",
    logo: telnyxLogo,
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

  const fetchConfigs = async () => {
    if (!user) return;
    const { data } = await supabase.from("phone_configs").select("*").order("created_at", { ascending: false });
    setConfigs((data as PhoneConfig[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, [user]);

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
      setForm({});
    }
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedProvider) return;
    setSaving(true);

    const insertData: Record<string, any> = {
      user_id: user.id,
      provider: selectedProvider,
      phone_number: form.phone_number,
    };

    if (selectedProvider === "twilio") {
      insertData.twilio_account_sid = form.twilio_account_sid;
      insertData.twilio_auth_token = form.twilio_auth_token;
    } else if (selectedProvider === "telnyx") {
      insertData.telnyx_api_key = form.telnyx_api_key;
      insertData.telnyx_connection_id = form.telnyx_connection_id;
    }

    const { error } = await supabase.from("phone_configs").insert(insertData as any);

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const provider = PROVIDERS.find(p => p.id === selectedProvider);
      toast({ title: `${provider?.name} phone number added successfully` });
      setDialogOpen(false);
      setSelectedProvider(null);
      setForm({});
      fetchConfigs();
    }
  };

  const deleteConfig = async (id: string) => {
    await supabase.from("phone_configs").delete().eq("id", id);
    toast({ title: "Configuration deleted" });
    fetchConfigs();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("phone_configs").update({ is_active: !current } as any).eq("id", id);
    fetchConfigs();
  };

  const currentProviderConfig = PROVIDERS.find(p => p.id === selectedProvider);

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
                          <img src={provider?.logo} alt={provider?.name} className="h-8 w-8 rounded object-contain" />
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
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={config.is_active ? "default" : "secondary"}>
                            {config.is_active ? "Active" : "Inactive"}
                          </Badge>
                          <Switch
                            checked={config.is_active}
                            onCheckedChange={() => toggleActive(config.id, config.is_active)}
                          />
                          <Button variant="ghost" size="icon" onClick={() => deleteConfig(config.id)}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
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
                Connect {currentProviderConfig?.name}
              </DialogTitle>
              <DialogDescription>
                Enter your {currentProviderConfig?.name} credentials to enable phone calls.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {currentProviderConfig?.fields.map((field) => (
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
                        required
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
              ))}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Connecting..." : `Connect ${currentProviderConfig?.name}`}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
