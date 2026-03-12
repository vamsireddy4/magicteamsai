import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Webhook, Loader2, Globe } from "lucide-react";

const WEBHOOK_EVENTS = [
  { value: "call.started", label: "Call Started" },
  { value: "call.completed", label: "Call Completed" },
  { value: "call.failed", label: "Call Failed" },
  { value: "call.voicemail", label: "Voicemail Detected" },
  { value: "transcript.ready", label: "Transcript Ready" },
];

interface WebhookRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  secret: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  name: string;
}

export default function Webhooks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    url: "",
    agent_id: "all" as string,
    events: ["call.completed"] as string[],
    secret: "",
  });

  const fetchData = async () => {
    if (!user) return;
    const [{ data: wh }, { data: ag }] = await Promise.all([
      supabase.from("webhooks").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name"),
    ]);
    setWebhooks((wh as WebhookRow[]) || []);
    setAgents(ag || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('webhooks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhooks' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const toggleEvent = (event: string) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter(e => e !== event)
        : [...f.events, event],
    }));
  };

  const handleCreate = async () => {
    if (!user || !form.name || !form.url) return;
    setSaving(true);
    const { error } = await supabase.from("webhooks").insert({
      user_id: user.id,
      name: form.name,
      url: form.url,
      agent_id: form.agent_id === "all" ? null : form.agent_id,
      events: form.events,
      secret: form.secret || null,
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Webhook created" });
      setForm({ name: "", url: "", agent_id: "all", events: ["call.completed"], secret: "" });
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("webhooks").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Webhook deleted" });
      fetchData();
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("webhooks").update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return "All Agents";
    return agents.find(a => a.id === agentId)?.name || "Unknown";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Webhooks</h1>
            <p className="text-muted-foreground mt-1">Send call data to external URLs when events occur.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Webhook</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Webhook</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input placeholder="e.g. CRM Integration" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input placeholder="https://your-api.com/webhook" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={form.agent_id} onValueChange={v => setForm({ ...form, agent_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Agents</SelectItem>
                      {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Events</Label>
                  <div className="space-y-2">
                    {WEBHOOK_EVENTS.map(ev => (
                      <label key={ev.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.events.includes(ev.value)}
                          onCheckedChange={() => toggleEvent(ev.value)}
                        />
                        {ev.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secret (optional)</Label>
                  <Input placeholder="Signing secret for verification" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} />
                  <p className="text-xs text-muted-foreground">Used to sign webhook payloads for verification.</p>
                </div>
                <Button onClick={handleCreate} disabled={saving || !form.name || !form.url || form.events.length === 0} className="w-full">
                  {saving ? "Creating..." : "Create Webhook"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : webhooks.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No webhooks yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Create a webhook to send call data to external services.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {webhooks.map(wh => (
              <Card key={wh.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{wh.name}</span>
                        <Badge variant={wh.is_active ? "default" : "secondary"}>
                          {wh.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{wh.url}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">{getAgentName(wh.agent_id)} ·</span>
                        {wh.events.map(ev => (
                          <Badge key={ev} variant="outline" className="text-xs">{ev}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={wh.is_active} onCheckedChange={() => toggleActive(wh.id, wh.is_active)} />
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(wh.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
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
