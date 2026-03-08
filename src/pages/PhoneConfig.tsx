import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Phone, Trash2 } from "lucide-react";
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
    friendly_name: "",
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
      ...form,
      user_id: user.id,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Phone number added" });
      setDialogOpen(false);
      setForm({ twilio_account_sid: "", twilio_auth_token: "", phone_number: "", friendly_name: "" });
      fetchConfigs();
    }
  };

  const deleteConfig = async (id: string) => {
    await supabase.from("phone_configs").delete().eq("id", id);
    fetchConfigs();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Phone Numbers</h1>
            <p className="text-muted-foreground mt-1">Configure Twilio phone numbers for your agents.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Number</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Twilio Phone Number</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    value={form.phone_number}
                    onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="+15551234567"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Friendly Name (optional)</Label>
                  <Input
                    value={form.friendly_name}
                    onChange={(e) => setForm({ ...form, friendly_name: e.target.value })}
                    placeholder="e.g. Main Office Line"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Twilio Account SID</Label>
                  <Input
                    value={form.twilio_account_sid}
                    onChange={(e) => setForm({ ...form, twilio_account_sid: e.target.value })}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Twilio Auth Token</Label>
                  <Input
                    type="password"
                    value={form.twilio_auth_token}
                    onChange={(e) => setForm({ ...form, twilio_auth_token: e.target.value })}
                    placeholder="Your Twilio auth token"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Your Twilio credentials are stored securely and used to handle calls.
                </p>
                <Button type="submit" className="w-full">Add Phone Number</Button>
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
              <Phone className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No phone numbers</h3>
              <p className="text-sm text-muted-foreground mb-4">Add a Twilio phone number to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {configs.map((config) => (
              <Card key={config.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
                      <Phone className="h-4 w-4 text-accent-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{config.phone_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {config.friendly_name || "No label"} · SID: {config.twilio_account_sid.slice(0, 8)}...
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
