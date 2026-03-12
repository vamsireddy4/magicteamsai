import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, CalendarIcon, Loader2, Clock, Phone } from "lucide-react";
import { format, isSameDay, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface ScheduledCallRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  recipient_number: string;
  recipient_name: string | null;
  scheduled_at: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface AgentRow {
  id: string;
  name: string;
}

export default function ScheduledCalls() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [calls, setCalls] = useState<ScheduledCallRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [form, setForm] = useState({
    recipient_number: "",
    recipient_name: "",
    agent_id: "" as string,
    date: new Date(),
    time: "10:00",
    notes: "",
  });

  const fetchData = async () => {
    if (!user) return;
    const [{ data: sc }, { data: ag }] = await Promise.all([
      supabase.from("scheduled_calls").select("*").order("scheduled_at", { ascending: true }),
      supabase.from("agents").select("id, name"),
    ]);
    setCalls((sc as ScheduledCallRow[]) || []);
    setAgents(ag || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('scheduled-calls-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_calls' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleCreate = async () => {
    if (!user || !form.recipient_number || !form.agent_id) return;
    setSaving(true);
    const [hours, minutes] = form.time.split(":").map(Number);
    const scheduledAt = new Date(form.date);
    scheduledAt.setHours(hours, minutes, 0, 0);

    const { error } = await supabase.from("scheduled_calls").insert({
      user_id: user.id,
      recipient_number: form.recipient_number,
      recipient_name: form.recipient_name || null,
      agent_id: form.agent_id || null,
      scheduled_at: scheduledAt.toISOString(),
      notes: form.notes || null,
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Call scheduled" });
      setForm({ recipient_number: "", recipient_name: "", agent_id: "", date: new Date(), time: "10:00", notes: "" });
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("scheduled_calls").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Scheduled call removed" });
      fetchData();
    }
  };

  // Get calls for the selected calendar date
  const callsForSelectedDate = calls.filter(c =>
    isSameDay(parseISO(c.scheduled_at), selectedDate)
  );

  // Get dates that have scheduled calls (for calendar dots)
  const datesWithCalls = calls.map(c => parseISO(c.scheduled_at));

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "default";
      case "failed": return "destructive";
      case "in_progress": return "secondary";
      default: return "outline";
    }
  };

  const getAgentName = (agentId: string | null) => {
    if (!agentId) return "No agent";
    return agents.find(a => a.id === agentId)?.name || "Unknown";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Call Calendar</h1>
            <p className="text-muted-foreground mt-1">Schedule outbound calls for specific dates and times.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Schedule Call</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Schedule a Call</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Recipient Name</Label>
                    <Input placeholder="John Doe" value={form.recipient_name} onChange={e => setForm({ ...form, recipient_name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone Number *</Label>
                    <Input placeholder="+1234567890" value={form.recipient_number} onChange={e => setForm({ ...form, recipient_number: e.target.value })} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Agent *</Label>
                  <Select value={form.agent_id} onValueChange={v => setForm({ ...form, agent_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(form.date, "PPP")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar mode="single" selected={form.date} onSelect={d => d && setForm({ ...form, date: d })} initialFocus />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <Input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea placeholder="Optional notes about this call..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
                </div>
                <Button onClick={handleCreate} disabled={saving || !form.recipient_number || !form.agent_id} className="w-full">
                  {saving ? "Scheduling..." : "Schedule Call"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
            {/* Calendar */}
            <Card>
              <CardContent className="p-3">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={d => d && setSelectedDate(d)}
                  modifiers={{ hasCall: datesWithCalls }}
                  modifiersClassNames={{ hasCall: "bg-primary/20 font-bold" }}
                />
              </CardContent>
            </Card>

            {/* Day view */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                {format(selectedDate, "EEEE, MMMM d, yyyy")}
              </h2>
              {callsForSelectedDate.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <Clock className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground text-sm">No calls scheduled for this day.</p>
                  </CardContent>
                </Card>
              ) : (
                callsForSelectedDate.map(call => (
                  <Card key={call.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{call.recipient_name || call.recipient_number}</span>
                            <Badge variant={getStatusColor(call.status) as any}>{call.status}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(parseISO(call.scheduled_at), "h:mm a")} · {call.recipient_number} · {getAgentName(call.agent_id)}
                          </p>
                          {call.notes && <p className="text-xs text-muted-foreground mt-1">{call.notes}</p>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(call.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
