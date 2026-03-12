import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, Phone, PhoneCall, Clock, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ agents: 0, calls: 0, phones: 0, totalDuration: 0 });
  const [recentCalls, setRecentCalls] = useState<any[]>([]);

  const fetchData = async () => {
    if (!user) return;
    const [agentsRes, callsRes, phonesRes, recentRes] = await Promise.all([
      supabase.from("agents").select("id", { count: "exact", head: true }),
      supabase.from("call_logs").select("id, duration", { count: "exact" }),
      supabase.from("phone_configs").select("id", { count: "exact", head: true }),
      supabase.from("call_logs").select("*, agents(name)").order("started_at", { ascending: false }).limit(5),
    ]);

    const totalDuration = callsRes.data?.reduce((acc, c) => acc + (c.duration || 0), 0) || 0;

    setStats({
      agents: agentsRes.count || 0,
      calls: callsRes.count || 0,
      phones: phonesRes.count || 0,
      totalDuration,
    });
    setRecentCalls(recentRes.data || []);
  };

  useEffect(() => {
    if (!user) return;
    // Auto-sync on load
    supabase.functions.invoke("sync-call-data").then(() => fetchData());

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Manage your AI receptionists and monitor calls.</p>
          </div>
          <div className="flex gap-2">
            <Link to="/agents/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Agent
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <Bot className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.agents}</p>
                <p className="text-sm text-muted-foreground">Active Agents</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <PhoneCall className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.calls}</p>
                <p className="text-sm text-muted-foreground">Total Calls</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <Phone className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.phones}</p>
                <p className="text-sm text-muted-foreground">Phone Numbers</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                <Clock className="h-6 w-6 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatDuration(stats.totalDuration)}</p>
                <p className="text-sm text-muted-foreground">Total Duration</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent calls */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Calls</CardTitle>
            <Link to="/call-logs">
              <Button variant="ghost" size="sm">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No calls yet. Set up an agent and phone number to get started.
              </p>
            ) : (
              <div className="space-y-3">
                {recentCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                        call.direction === "inbound" ? "bg-accent" : "bg-primary/10"
                      }`}>
                        <PhoneCall className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {call.direction === "inbound" ? call.caller_number : call.recipient_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(call as any).agents?.name || "Unknown Agent"} · {call.direction}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium font-mono">{formatDuration(call.duration || 0)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(call.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(call.started_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
