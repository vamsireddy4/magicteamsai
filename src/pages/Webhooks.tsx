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
import { Plus, Trash2, Webhook, Loader2, Globe, Pencil, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getFunctionUnavailableMessage, isEdgeFunctionUnavailable } from "@/lib/edge-functions";

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
  const [editingId, setEditingId] = useState<string | null>(null);

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
  const syncToUltravox = async (agentId: string | null) => {
    try {
      await supabase.functions.invoke("sync-ultravox-agent", {
        body: { agent_id: agentId || "global" },
      });
    } catch (err) {
      console.error("Ultravox sync failed:", err);
      if (isEdgeFunctionUnavailable(err)) {
        toast({ title: "Sync unavailable", description: getFunctionUnavailableMessage("Ultravox sync"), variant: "destructive" });
      }
    }
  };

  const handleSave = async () => {
    if (!user || !form.url) return;
    setSaving(true);
    
    // Generate a default name from URL if name is empty
    const webhookName = form.name || (() => {
      try { return new URL(form.url).hostname; } catch { return "Webhook"; }
    })();

    const payload = {
      user_id: user.id,
      name: webhookName,
      url: form.url,
      agent_id: form.agent_id === "all" ? null : form.agent_id,
      events: form.events,
      secret: form.secret || null,
    };

    let error;
    if (editingId) {
      const { error: err } = await supabase
        .from("webhooks")
        .update(payload as any)
        .eq("id", editingId);
      error = err;
    } else {
      const { error: err } = await supabase
        .from("webhooks")
        .insert(payload as any);
      error = err;
    }

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingId ? "Webhook updated" : "Webhook created" });
      const targetAgentId = form.agent_id === "all" ? null : form.agent_id;
      syncToUltravox(targetAgentId);
      setForm({ name: "", url: "", agent_id: "all", events: ["call.completed"], secret: "" });
      setEditingId(null);
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleEdit = (wh: WebhookRow) => {
    setEditingId(wh.id);
    setForm({
      name: wh.name,
      url: wh.url,
      agent_id: wh.agent_id || "all",
      events: wh.events,
      secret: wh.secret || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = async (row: WebhookRow) => {
    const { error } = await supabase.from("webhooks").delete().eq("id", row.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Webhook deleted" });
      fetchData();
      syncToUltravox(row.agent_id);
    }
  };

  const toggleActive = async (row: WebhookRow) => {
    await supabase.from("webhooks").update({ is_active: !row.is_active } as any).eq("id", row.id);
    fetchData();
    syncToUltravox(row.agent_id);
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
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEditingId(null);
              setForm({ name: "", url: "", agent_id: "all", events: ["call.completed"], secret: "" });
            }
          }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Webhook</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Webhook" : "Create Webhook"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
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
                <Button onClick={handleSave} disabled={saving || !form.url || form.events.length === 0} className="w-full">
                  {saving ? "Saving..." : (editingId ? "Update Webhook" : "Create Webhook")}
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
              <Card key={wh.id} className="overflow-hidden">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                      <Globe className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{wh.url}</p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-muted-foreground mr-1">{getAgentName(wh.agent_id)}</span>
                        {wh.events.map(ev => (
                          <Badge key={ev} variant="outline" className="text-[10px] py-0 px-1.5 h-4 bg-muted/30">
                            {ev.replace("call.", "")}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-2 mr-2">
                      <Switch 
                        checked={wh.is_active} 
                        onCheckedChange={() => toggleActive(wh)} 
                        className="scale-90"
                      />
                      <Badge 
                        variant={wh.is_active ? "default" : "secondary"}
                        className="text-[10px] py-0 px-1.5 h-4"
                      >
                        {wh.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(wh)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDelete(wh)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
