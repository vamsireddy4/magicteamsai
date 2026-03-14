import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneCall, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";

export default function OutboundCall() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Tables<"agents">[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<Tables<"phone_configs">[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    agent_id: "",
    recipient_number: "",
    phone_config_id: "",
  });

  useEffect(() => {
    if (!user) return;
    supabase.from("agents").select("*").eq("is_active", true).then(({ data }) => setAgents(data || []));
    supabase.from("phone_configs").select("*").eq("is_active", true).then(({ data }) => setPhoneConfigs(data || []));
  }, [user]);

  const selectedAgent = agents.find((a) => a.id === form.agent_id);
  const selectedPhone = phoneConfigs.find((pc) => pc.id === form.phone_config_id);

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("make-outbound-call", {
        body: {
          agent_id: form.agent_id,
          recipient_number: form.recipient_number,
          phone_config_id: form.phone_config_id,
        },
      });

      if (error) throw error;
      toast({ title: "Call initiated!", description: "The outbound call is being placed." });
      setForm({ ...form, recipient_number: "" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outbound Call</h1>
          <p className="text-muted-foreground mt-1">Make an AI-powered outbound call.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5" />
              Place a Call
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCall} className="space-y-4">
              <div className="space-y-2">
                <Label>Agent</Label>
                <Select value={form.agent_id} onValueChange={(val) => setForm({ ...form, agent_id: val })}>
                  <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recipient Phone Number</Label>
                <Input
                  value={form.recipient_number}
                  onChange={(e) => setForm({ ...form, recipient_number: e.target.value })}
                  placeholder="+15551234567"
                  required
                />
                <p className="text-xs text-muted-foreground">Include country code (e.g. +1 for US)</p>
              </div>
              <div className="space-y-2">
                <Label>Phone Number (Caller ID)</Label>
                <Select value={form.phone_config_id} onValueChange={(val) => setForm({ ...form, phone_config_id: val })}>
                  <SelectTrigger><SelectValue placeholder="Select a phone number" /></SelectTrigger>
                  <SelectContent>
                    {phoneConfigs.map((pc) => (
                      <SelectItem key={pc.id} value={pc.id}>
                        {pc.phone_number} {pc.friendly_name ? `(${pc.friendly_name})` : ""} — {pc.provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !form.agent_id || !form.phone_config_id}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Placing Call...</>
                ) : (
                  <><PhoneCall className="h-4 w-4 mr-2" />Place Call</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
