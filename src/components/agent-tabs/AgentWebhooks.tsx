import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Webhook, Globe } from "lucide-react";

const WEBHOOK_EVENTS = [
  { value: "call.started", label: "Start Call" },
  { value: "call.ended", label: "End Call" },
  { value: "call.billed", label: "Billed Call" },
  { value: "call.joined", label: "Joined Call" },
];

interface WebhookRow {
  id: string; user_id: string; agent_id: string | null; name: string; url: string;
  events: string[]; is_active: boolean; secret: string | null; created_at: string;
}

interface Props {
  agentId: string;
  agentName: string;
  userId: string;
}

export default function AgentWebhooks({ agentId, agentName, userId }: Props) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    url: "",
    events: [] as string[],
    scope: "agent" as "agent" | "global",
    secret: "",
  });

  const fetchData = async () => {
    const { data } = await supabase
      .from("webhooks")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });
    setWebhooks((data as WebhookRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`webhooks-agent-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "webhooks" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const toggleEvent = (event: string) => {
    setForm(f => ({ ...f, events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event] }));
  };

  const syncAgentToUltravox = async () => {
    try {
      await supabase.functions.invoke("sync-ultravox-agent", {
        body: { agent_id: agentId },
      });
    } catch (err) {
      console.error("Ultravox sync failed:", err);
    }
  };

  const handleCreate = async () => {
    if (!form.url || form.events.length === 0) return;
    setSaving(true);

    // Generate a name from the URL
    const urlName = (() => {
      try { return new URL(form.url).hostname; } catch { return "Webhook"; }
    })();

    const { error } = await supabase.from("webhooks").insert({
      user_id: userId,
      name: urlName,
      url: form.url,
      agent_id: form.scope === "agent" ? agentId : null,
      events: form.events,
      secret: form.secret || null,
    } as any);

    if (error) {
      setSaving(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    // Sync to Ultravox so the webhook is registered there too
    await syncAgentToUltravox();

    setSaving(false);
    toast({ title: "Webhook created" });
    setForm({ url: "", events: [], scope: "agent", secret: "" });
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("webhooks").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Webhook deleted" });
      fetchData();
      syncAgentToUltravox();
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("webhooks").update({ is_active: !current } as any).eq("id", id);
    fetchData();
    syncAgentToUltravox();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Send call data to external URLs when events occur.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Webhook</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Webhook</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Webhooks allow you to receive real-time notifications about events in your Ultravox account. You can configure webhooks to send HTTP POST requests to a specified URL when certain events occur.
            </p>

            <div className="space-y-6 pt-2">
              {/* Destination URL */}
              <div className="space-y-2">
                <Label className="text-foreground font-semibold">Destination URL</Label>
                <Input
                  placeholder="https://example.com"
                  value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })}
                  className="bg-background"
                />
              </div>

              {/* Webhook Types */}
              <div className="space-y-3">
                <Label className="text-foreground font-semibold">Select Webhook Types</Label>
                <div className="space-y-2.5">
                  {WEBHOOK_EVENTS.map(ev => (
                    <label key={ev.value} className="flex items-center gap-3 text-sm cursor-pointer">
                      <Checkbox
                        checked={form.events.includes(ev.value)}
                        onCheckedChange={() => toggleEvent(ev.value)}
                      />
                      <span className="text-foreground">{ev.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Scope */}
              <div className="space-y-2">
                <Label className="text-foreground font-semibold">Scope</Label>
                <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as "agent" | "global" })}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">{agentName}</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Secrets */}
              <div className="space-y-2">
                <Label className="text-foreground font-semibold">Secrets</Label>
                <Input
                  placeholder="Signing secret (optional)"
                  value={form.secret}
                  onChange={e => setForm({ ...form, secret: e.target.value })}
                  className="bg-background"
                />
              </div>

              <Button
                onClick={handleCreate}
                disabled={saving || !form.url || form.events.length === 0}
                className="w-full"
                variant="secondary"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <Card key={i} className="animate-pulse"><CardContent className="p-6 h-16" /></Card>)}</div>
      ) : webhooks.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12">
          <Webhook className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No webhooks yet. Create one to send call data externally.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {webhooks.map(wh => (
            <Card key={wh.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{wh.name}</span>
                      <Badge variant={wh.is_active ? "default" : "secondary"}>{wh.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                    <div className="flex gap-1 mt-0.5 flex-wrap">{wh.events.map(ev => <Badge key={ev} variant="outline" className="text-xs">{ev}</Badge>)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={wh.is_active} onCheckedChange={() => toggleActive(wh.id, wh.is_active)} />
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(wh.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
