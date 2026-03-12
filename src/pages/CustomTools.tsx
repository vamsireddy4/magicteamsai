import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Wrench, Loader2, Code2 } from "lucide-react";
import CreateToolDialog from "@/components/custom-tools/CreateToolDialog";

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

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('custom-tools-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_tools' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

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
          {user && <CreateToolDialog agents={agents} userId={user.id} onCreated={fetchData} />}
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
