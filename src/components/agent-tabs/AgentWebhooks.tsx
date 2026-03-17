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
import { Plus, Trash2, Webhook, Globe, Pencil, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getFunctionUnavailableMessage, isEdgeFunctionUnavailable } from "@/lib/edge-functions";

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
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchData = async () => {
    const { data } = await supabase
      .from("webhooks")
      .select("*")
      .or(`agent_id.eq.${agentId},agent_id.is.null`)
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

  const syncToUltravox = async (scope: "agent" | "global" = "agent") => {
    try {
      await supabase.functions.invoke("sync-ultravox-agent", {
        body: { agent_id: scope === "global" ? "global" : agentId },
      });
    } catch (err) {
      console.error("Ultravox sync failed:", err);
      if (isEdgeFunctionUnavailable(err)) {
        toast({ title: "Sync unavailable", description: getFunctionUnavailableMessage("Ultravox sync"), variant: "destructive" });
      }
    }
  };

  const handleSave = async () => {
    if (!form.url || form.events.length === 0) return;
    setSaving(true);

    const urlName = (() => {
      try { return new URL(form.url).hostname; } catch { return "Webhook"; }
    })();

    const payload = {
      user_id: userId,
      name: urlName,
      url: form.url,
      agent_id: form.scope === "agent" ? agentId : null,
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

    if (error) {
      setSaving(false);
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    await syncToUltravox(form.scope);

    setSaving(false);
    toast({ title: editingId ? "Webhook updated" : "Webhook created" });
    setForm({ url: "", events: [], scope: "agent", secret: "" });
    setEditingId(null);
    setDialogOpen(false);
  };

  const handleEdit = (wh: WebhookRow) => {
    setEditingId(wh.id);
    setForm({
      url: wh.url,
      events: wh.events,
      scope: wh.agent_id ? "agent" : "global",
      secret: wh.secret || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = async (row: WebhookRow) => {
    const { error } = await supabase.from("webhooks").delete().eq("id", row.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Webhook deleted" });
      fetchData();
      syncToUltravox(row.agent_id ? "agent" : "global");
    }
  };

  const toggleActive = async (row: WebhookRow) => {
    await supabase.from("webhooks").update({ is_active: !row.is_active } as any).eq("id", row.id);
    fetchData();
    syncToUltravox(row.agent_id ? "agent" : "global");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Send call data to external URLs when events occur.</p>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm({ url: "", events: [], scope: "agent", secret: "" });
          }
        }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Webhook</Button></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Webhook" : "Add Webhook"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Configure where events should be sent.
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
                onClick={handleSave}
                disabled={saving || !form.url || form.events.length === 0}
                className="w-full"
                variant="secondary"
              >
                {saving ? "Saving..." : (editingId ? "Update" : "Save")}
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
            <Card key={wh.id} className="overflow-hidden">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="bg-primary/10 p-2 rounded-lg shrink-0">
                    <Globe className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{wh.url}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
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
  );
}
