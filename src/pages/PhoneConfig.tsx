import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Plus, Phone, Trash2, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

export default function PhoneConfig() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Tables<"phone_configs">[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    twilio_account_sid: "",
    twilio_auth_token: "",
    phone_number: "",
  });

  const fetchConfigs = async () => {
    if (!user) return;
    const { data } = await supabase.from("phone_configs").select("*").order("created_at", { ascending: false });
    setConfigs(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchConfigs(); }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const { error } = await supabase.from("phone_configs").insert({
      twilio_account_sid: form.twilio_account_sid,
      twilio_auth_token: form.twilio_auth_token,
      phone_number: form.phone_number,
      user_id: user.id,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Twilio configuration added successfully" });
      setDialogOpen(false);
      setForm({ twilio_account_sid: "", twilio_auth_token: "", phone_number: "" });
      fetchConfigs();
    }
  };

  const deleteConfig = async (id: string) => {
    await supabase.from("phone_configs").delete().eq("id", id);
    toast({ title: "Configuration deleted" });
    fetchConfigs();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Twilio Configuration</h1>
            <p className="text-muted-foreground mt-1">Connect your Twilio account to enable phone calls.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Twilio Account</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Connect Twilio Account</DialogTitle>
                <DialogDescription>
                  Enter your Twilio credentials to enable phone calls for your AI agents.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="account_sid">Account SID</Label>
                  <Input
                    id="account_sid"
                    value={form.twilio_account_sid}
                    onChange={(e) => setForm({ ...form, twilio_account_sid: e.target.value })}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Find this in your Twilio Console dashboard.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth_token">Auth Token</Label>
                  <Input
                    id="auth_token"
                    type="password"
                    value={form.twilio_auth_token}
                    onChange={(e) => setForm({ ...form, twilio_auth_token: e.target.value })}
                    placeholder="Your Twilio auth token"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Your auth token is also in the Twilio Console.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone_number">Phone Number</Label>
                  <Input
                    id="phone_number"
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="+15551234567"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Your Twilio phone number in E.164 format (e.g., +15551234567).
                  </p>
                </div>
                <Button type="submit" className="w-full">Connect Twilio Account</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-6 h-20" /></Card>
            ))}
          </div>
        ) : configs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
                <Settings className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No Twilio account connected</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                Connect your Twilio account to enable inbound and outbound phone calls for your AI agents.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />Add Twilio Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {configs.map((config) => (
              <Card key={config.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{config.phone_number}</p>
                      <p className="text-xs text-muted-foreground">
                        Account SID: {config.twilio_account_sid.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={config.is_active ? "default" : "secondary"}>
                      {config.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => deleteConfig(config.id)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
