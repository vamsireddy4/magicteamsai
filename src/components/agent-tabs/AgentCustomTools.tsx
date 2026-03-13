import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Wrench, Code2 } from "lucide-react";
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

interface Props {
  agentId: string;
  agentName: string;
  userId: string;
}

export default function AgentCustomTools({ agentId, agentName, userId }: Props) {
  const { toast } = useToast();
  const [tools, setTools] = useState<AgentToolRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const { data } = await supabase
      .from("agent_tools")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });
    setTools((data as AgentToolRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`tools-agent-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_tools" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const syncAgent = async () => {
    try {
      await supabase.functions.invoke("sync-ultravox-agent", {
        body: { agent_id: agentId },
      });
    } catch (err) {
      console.error("Ultravox sync failed:", err);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("agent_tools").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Tool deleted" }); fetchData(); syncAgent(); }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("agent_tools").update({ is_active: !current } as any).eq("id", id);
    fetchData();
    syncAgent();
  };

  // Pass only this agent to CreateToolDialog
  const agents = [{ id: agentId, name: agentName }];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">HTTP tools this agent can trigger during calls.</p>
        <CreateToolDialog agents={agents} userId={userId} onCreated={fetchData} />
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <Card key={i} className="animate-pulse"><CardContent className="p-6 h-16" /></Card>)}</div>
      ) : tools.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-12">
          <Wrench className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No custom tools yet. Create tools your agent can invoke.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {tools.map(tool => (
            <Card key={tool.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Code2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-medium text-sm">{tool.name}</span>
                      <Badge variant={tool.is_active ? "default" : "secondary"}>{tool.is_active ? "Active" : "Inactive"}</Badge>
                      <Badge variant="outline">{tool.http_method}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">{tool.description}</p>
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
  );
}
