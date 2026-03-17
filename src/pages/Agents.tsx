import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Bot, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { getFunctionUnavailableMessage, isEdgeFunctionUnavailable } from "@/lib/edge-functions";
import CreateAgentWizard from "@/components/CreateAgentWizard";

export default function Agents() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Tables<"agents">[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchAgents = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: false });
    setAgents(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchAgents();
    const channel = supabase
      .channel('agents-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => fetchAgents())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const deleteAgent = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this agent?")) return;
    try {
      const { error } = await supabase.functions.invoke("delete-ultravox-agent", {
        body: { agent_id: id },
      });
      
      // If edge function fails (or is unavailable), try local delete
      if (error) {
        console.warn("Edge function delete failed, trying local delete...", error);
        const { error: localError } = await supabase.from("agents").delete().eq("id", id);
        if (localError) throw localError;
      }

      toast({ title: "Agent deleted" });
      // The user specifically asked for automatic refresh
      window.location.reload();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to delete agent", variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
            <p className="text-muted-foreground mt-1">Create and manage your AI receptionists.</p>
          </div>
          <Button onClick={() => setWizardOpen(true)}><Plus className="h-4 w-4 mr-2" />New Agent</Button>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-6 h-40" /></Card>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Bot className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No agents yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first AI receptionist to get started.</p>
              <Button onClick={() => setWizardOpen(true)}>Create Agent</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Card key={agent.id} className="group relative cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/agents/${agent.id}`)}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                      <Bot className="h-5 w-5 text-accent-foreground" />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <Link to={`/agents/${agent.id}`}>
                          <DropdownMenuItem><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                        </Link>
                        <DropdownMenuItem onClick={() => deleteAgent(agent.id)} className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <h3 className="font-semibold mb-1">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {agent.system_prompt}
                  </p>
                  <Badge variant={agent.is_active ? "default" : "secondary"}>
                    {agent.is_active ? "Active" : "Inactive"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {user && (
          <CreateAgentWizard 
            open={wizardOpen} 
            onOpenChange={setWizardOpen} 
            userId={user.id} 
          />
        )}
      </div>
    </DashboardLayout>
  );
}
