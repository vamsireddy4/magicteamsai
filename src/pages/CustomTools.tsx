import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Wrench, Loader2, Code2 } from "lucide-react";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

interface AgentToolRow {
  id: string;
  user_id: string;
  agent_id: string;
  name: string;
  description: string;
  tool_type: string;
  http_method: string;
  http_url: string;
  http_headers: Record<string, string>;
  http_body_template: Record<string, any>;
  parameters: any[];
  is_active: boolean;
  created_at: string;
}

interface AgentRow {
  id: string;
  name: string;
}

export default function CustomTools() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tools, setTools] = useState<AgentToolRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    agent_id: "" as string,
    http_method: "POST",
    http_url: "",
    http_headers: "{}",
    http_body_template: "{}",
    parameters: "[]",
  });

  const fetchData = async () => {
    if (!user) return;
    const [{ data: tl }, { data: ag }] = await Promise.all([
      supabase.from("agent_tools").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name"),
    ]);
    setTools((tl as AgentToolRow[]) || []);
    setAgents(ag || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleCreate = async () => {
    if (!user || !form.name || !form.agent_id || !form.http_url) return;
    setSaving(true);

    let headers = {}, bodyTemplate = {}, params: any[] = [];
    try {
      headers = JSON.parse(form.http_headers);
      bodyTemplate = JSON.parse(form.http_body_template);
      params = JSON.parse(form.parameters);
    } catch {
      toast({ title: "Invalid JSON", description: "Check your headers, body template, or parameters JSON.", variant: "destructive" });
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("agent_tools").insert({
      user_id: user.id,
      agent_id: form.agent_id,
      name: form.name,
      description: form.description,
      http_method: form.http_method,
      http_url: form.http_url,
      http_headers: headers,
      http_body_template: bodyTemplate,
      parameters: params,
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tool created" });
      setForm({ name: "", description: "", agent_id: "", http_method: "POST", http_url: "", http_headers: "{}", http_body_template: "{}", parameters: "[]" });
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("agent_tools").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tool deleted" });
      fetchData();
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("agent_tools").update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const getAgentName = (agentId: string) => agents.find(a => a.id === agentId)?.name || "Unknown";

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Custom Tools</h1>
            <p className="text-muted-foreground mt-1">Define HTTP tools your AI agents can trigger during calls.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Tool</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Custom Tool</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Tool Name</Label>
                  <Input placeholder="e.g. check_availability" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                  <p className="text-xs text-muted-foreground">The name the AI uses to invoke this tool.</p>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea placeholder="Describe what this tool does so the AI knows when to use it..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={form.agent_id} onValueChange={v => setForm({ ...form, agent_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                  <div className="space-y-2">
                    <Label>Method</Label>
                    <Select value={form.http_method} onValueChange={v => setForm({ ...form, http_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HTTP_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>URL</Label>
                    <Input placeholder="https://api.example.com/check" value={form.http_url} onChange={e => setForm({ ...form, http_url: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Headers (JSON)</Label>
                  <Textarea className="font-mono text-xs" placeholder='{"Authorization": "Bearer xxx"}' value={form.http_headers} onChange={e => setForm({ ...form, http_headers: e.target.value })} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Body Template (JSON)</Label>
                  <Textarea className="font-mono text-xs" placeholder='{"query": "{{user_input}}"}' value={form.http_body_template} onChange={e => setForm({ ...form, http_body_template: e.target.value })} rows={3} />
                  <p className="text-xs text-muted-foreground">Use {"{{param}}"} placeholders for dynamic values.</p>
                </div>
                <div className="space-y-2">
                  <Label>Parameters (JSON array)</Label>
                  <Textarea className="font-mono text-xs" placeholder='[{"name": "date", "type": "string", "description": "The date to check"}]' value={form.parameters} onChange={e => setForm({ ...form, parameters: e.target.value })} rows={3} />
                  <p className="text-xs text-muted-foreground">Define parameters the AI should extract from conversation.</p>
                </div>
                <Button onClick={handleCreate} disabled={saving || !form.name || !form.agent_id || !form.http_url} className="w-full">
                  {saving ? "Creating..." : "Create Tool"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tools.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No custom tools yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Create tools your AI agents can invoke during calls.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {tools.map(tool => (
              <Card key={tool.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <Code2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-medium text-sm">{tool.name}</span>
                        <Badge variant={tool.is_active ? "default" : "secondary"}>
                          {tool.is_active ? "Active" : "Inactive"}
                        </Badge>
                        <Badge variant="outline">{tool.http_method}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{tool.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {getAgentName(tool.agent_id)} · {tool.http_url}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={tool.is_active} onCheckedChange={() => toggleActive(tool.id, tool.is_active)} />
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(tool.id)}>
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
