import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Phone, Target, MoreVertical, Pencil, Trash2, Play, Loader2, Users, CalendarDays, Clock, Hash, FileText, ArrowLeft } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

interface Campaign {
  id: string;
  venue_name: string;
  venue_location: string | null;
  start_date: string | null;
  end_date: string | null;
  times: string | null;
  age_range: string | null;
  round: number;
  status: string;
  booking_target: number | null;
  twilio_phone_number: string | null;
  elevenlabs_campaign_id: string | null;
  notes: string | null;
  created_at: string;
  phone_config_id: string | null;
  agent_id: string | null;
  delay_seconds: number;
  calls_made: number;
  total_contacts: number;
}

interface AgentRow { id: string; name: string; }
interface PhoneConfigRow { id: string; phone_number: string; friendly_name: string | null; provider: string; }

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-primary/10 text-primary",
};

const emptyForm = {
  venue_name: "", venue_location: "", start_date: "", end_date: "", times: "", age_range: "",
  round: 1, status: "draft", booking_target: "", twilio_phone_number: "", elevenlabs_campaign_id: "",
  notes: "", agent_id: "", phone_config_id: "", delay_seconds: "30",
};

export default function CampaignsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<PhoneConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState("all");
  const [runningCampaign, setRunningCampaign] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [contactCount, setContactCount] = useState(0);
  const [outcomeCounts, setOutcomeCounts] = useState<Record<string, number>>({});

  const fetchData = async () => {
    if (!user) return;
    const [{ data: camps }, { data: ag }, { data: pc }] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name"),
      supabase.from("phone_configs").select("id, phone_number, friendly_name, provider").eq("is_active", true),
    ]);
    setCampaigns((camps as Campaign[]) || []);
    setAgents(ag || []);
    setPhoneConfigs((pc as PhoneConfigRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const openCampaignDetail = async (c: Campaign) => {
    setSelectedCampaign(c);
    const [{ count: cCount }, { data: outcomes }] = await Promise.all([
      supabase.from("contacts").select("*", { count: "exact", head: true }).eq("campaign_id", c.id),
      supabase.from("call_outcomes").select("outcome").eq("campaign_id", c.id),
    ]);
    setContactCount(cCount || 0);
    const counts: Record<string, number> = {};
    (outcomes || []).forEach((o) => { counts[o.outcome] = (counts[o.outcome] || 0) + 1; });
    setOutcomeCounts(counts);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const payload = {
      user_id: user.id, venue_name: form.venue_name, venue_location: form.venue_location || null,
      start_date: form.start_date || null, end_date: form.end_date || null, times: form.times || null,
      age_range: form.age_range || null, round: form.round, status: form.status,
      booking_target: form.booking_target ? parseInt(form.booking_target) : null,
      twilio_phone_number: form.twilio_phone_number || null, elevenlabs_campaign_id: form.elevenlabs_campaign_id || null,
      notes: form.notes || null, agent_id: form.agent_id || null, phone_config_id: form.phone_config_id || null,
      delay_seconds: parseInt(form.delay_seconds) || 30,
    };
    const { error } = editingId
      ? await supabase.from("campaigns").update(payload).eq("id", editingId)
      : await supabase.from("campaigns").insert(payload as any);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: editingId ? "Campaign updated" : "Campaign created" }); setDialogOpen(false); setEditingId(null); setForm(emptyForm); fetchData(); }
  };

  const editCampaign = (c: Campaign) => {
    setEditingId(c.id);
    setForm({
      venue_name: c.venue_name, venue_location: c.venue_location || "", start_date: c.start_date || "",
      end_date: c.end_date || "", times: c.times || "", age_range: c.age_range || "", round: c.round,
      status: c.status, booking_target: c.booking_target?.toString() || "", twilio_phone_number: c.twilio_phone_number || "",
      elevenlabs_campaign_id: c.elevenlabs_campaign_id || "", notes: c.notes || "", agent_id: c.agent_id || "",
      phone_config_id: c.phone_config_id || "", delay_seconds: c.delay_seconds?.toString() || "30",
    });
    setDialogOpen(true);
  };

  const deleteCampaign = async (id: string) => {
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Campaign deleted" }); if (selectedCampaign?.id === id) setSelectedCampaign(null); fetchData(); }
  };

  const startCampaign = async (campaignId: string) => {
    setRunningCampaign(campaignId);
    try {
      const { data, error } = await supabase.functions.invoke("run-campaign", { body: { campaign_id: campaignId } });
      if (error) throw error;
      toast({ title: "Campaign started", description: `${data?.total || 0} calls queued` });
      fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setRunningCampaign(null); }
  };

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);
  const statusCounts = campaigns.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  const getAgentName = (id: string | null) => id ? agents.find(a => a.id === id)?.name || "Unknown" : "—";
  const getPhoneLabel = (id: string | null) => { if (!id) return "—"; const pc = phoneConfigs.find(p => p.id === id); return pc ? (pc.friendly_name || pc.phone_number) : "Unknown"; };

  // Campaign detail view
  if (selectedCampaign) {
    const c = selectedCampaign;
    const totalOutcomes = Object.values(outcomeCounts).reduce((a, b) => a + b, 0);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedCampaign(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{c.venue_name}</h2>
            {c.venue_location && <p className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {c.venue_location}</p>}
          </div>
          <div className="flex gap-2">
            <Badge className={`${STATUS_COLORS[c.status] || ""} text-sm px-3 py-1`}>{c.status}</Badge>
            <Badge variant="outline" className="text-sm px-3 py-1">Round {c.round}</Badge>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <Users className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{contactCount}</p>
              <p className="text-xs text-muted-foreground">Total Contacts</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Phone className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{c.calls_made}</p>
              <p className="text-xs text-muted-foreground">Calls Made</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Target className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{c.booking_target ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Booking Target</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <Hash className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{totalOutcomes}</p>
              <p className="text-xs text-muted-foreground">Total Outcomes</p>
            </CardContent>
          </Card>
        </div>

        {c.total_contacts > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Call Progress</span>
                <span className="font-medium">{c.calls_made} / {c.total_contacts}</span>
              </div>
              <Progress value={c.total_contacts > 0 ? (c.calls_made / c.total_contacts) * 100 : 0} className="h-3" />
            </CardContent>
          </Card>
        )}

        {Object.keys(outcomeCounts).length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Outcome Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]).map(([outcome, count]) => (
                  <div key={outcome} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-sm font-medium">{outcome}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Campaign Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                {c.agent_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Agent:</span>
                    <span className="font-medium">{getAgentName(c.agent_id)}</span>
                  </div>
                )}
                {c.phone_config_id && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Phone:</span>
                    <span className="font-medium">{getPhoneLabel(c.phone_config_id)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-28">Delay:</span>
                  <span className="font-medium">{c.delay_seconds}s between calls</span>
                </div>
                {c.age_range && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Age Range:</span>
                    <span className="font-medium">{c.age_range}</span>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {c.start_date && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Dates:</span>
                    <span className="font-medium">{c.start_date} → {c.end_date || "TBD"}</span>
                  </div>
                )}
                {c.times && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Times:</span>
                    <span className="font-medium">{c.times}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-28">Created:</span>
                  <span className="font-medium">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
            {c.notes && (
              <>
                <Separator className="my-4" />
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Notes</p>
                  <p className="text-sm">{c.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          {c.status === "draft" && c.agent_id && c.phone_config_id && (
            <Button onClick={() => startCampaign(c.id)} disabled={runningCampaign === c.id}>
              {runningCampaign === c.id ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</> : <><Play className="h-4 w-4 mr-2" /> Start Campaign</>}
            </Button>
          )}
          <Button variant="outline" onClick={() => editCampaign(c)}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
          <Button variant="destructive" onClick={() => deleteCampaign(c.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingId(null); setForm(emptyForm); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> New Campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? "Edit Campaign" : "New Campaign"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2"><Label>Venue Name *</Label><Input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} required /></div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Location</Label><Input value={form.venue_location} onChange={(e) => setForm({ ...form, venue_location: e.target.value })} /></div>
                <div className="space-y-2"><Label>Age Range</Label><Input value={form.age_range} onChange={(e) => setForm({ ...form, age_range: e.target.value })} placeholder="e.g. 5-12" /></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                <div className="space-y-2"><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Agent</Label><Select value={form.agent_id} onValueChange={(v) => setForm({ ...form, agent_id: v })}><SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger><SelectContent>{agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Phone Config</Label><Select value={form.phone_config_id} onValueChange={(v) => setForm({ ...form, phone_config_id: v })}><SelectTrigger><SelectValue placeholder="Select number" /></SelectTrigger><SelectContent>{phoneConfigs.map(pc => <SelectItem key={pc.id} value={pc.id}>{pc.friendly_name || pc.phone_number} ({pc.provider})</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Delay Between Calls (sec)</Label><Input type="number" value={form.delay_seconds} onChange={(e) => setForm({ ...form, delay_seconds: e.target.value })} min={5} /></div>
                <div className="space-y-2"><Label>Booking Target</Label><Input type="number" value={form.booking_target} onChange={(e) => setForm({ ...form, booking_target: e.target.value })} /></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Round</Label><Select value={String(form.round)} onValueChange={(v) => setForm({ ...form, round: parseInt(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Round 1</SelectItem><SelectItem value="2">Round 2</SelectItem><SelectItem value="3">Round 3</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="paused">Paused</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Times</Label><Input value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} placeholder="e.g. 9am-3pm" /></div>
                <div className="space-y-2"><Label>Twilio Phone Number</Label><Input value={form.twilio_phone_number} onChange={(e) => setForm({ ...form, twilio_phone_number: e.target.value })} placeholder="+44..." /></div>
              </div>
              <div className="space-y-2"><Label>ElevenLabs Campaign ID</Label><Input value={form.elevenlabs_campaign_id} onChange={(e) => setForm({ ...form, elevenlabs_campaign_id: e.target.value })} placeholder="Optional" /></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
              <div className="flex gap-3"><Button type="submit">{editingId ? "Update" : "Create"}</Button><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "draft", "active", "paused", "completed"].map((s) => (
          <Button key={s} variant={filter === s ? "default" : "outline"} size="sm" onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== "all" && statusCounts[s] ? ` (${statusCounts[s]})` : s === "all" ? ` (${campaigns.length})` : ""}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Card key={i}><CardContent className="h-40 animate-pulse bg-muted/50 rounded-lg" /></Card>)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">No campaigns yet. Create one to get started.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="relative cursor-pointer hover:shadow-md transition-shadow" onClick={() => openCampaignDetail(c)}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{c.venue_name}</CardTitle>
                    {c.venue_location && <CardDescription className="flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" /> {c.venue_location}</CardDescription>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); editCampaign(c); }}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteCampaign(c.id); }}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Badge className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge>
                  <Badge variant="outline">Round {c.round}</Badge>
                  {c.age_range && <Badge variant="secondary">{c.age_range}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {c.start_date && <p>📅 {c.start_date} → {c.end_date || "TBD"}</p>}
                  {c.times && <p>⏰ {c.times}</p>}
                  {c.agent_id && <p>🤖 {getAgentName(c.agent_id)}</p>}
                  {c.phone_config_id && <p className="flex items-center gap-1"><Phone className="h-3 w-3" /> {getPhoneLabel(c.phone_config_id)}</p>}
                  {c.booking_target && <p className="flex items-center gap-1"><Target className="h-3 w-3" /> Target: {c.booking_target}</p>}
                </div>
                {c.status === "active" && c.total_contacts > 0 && (
                  <div className="space-y-1">
                    <Progress value={(c.calls_made / c.total_contacts) * 100} className="h-2" />
                    <p className="text-xs text-muted-foreground">{c.calls_made} / {c.total_contacts} calls made</p>
                  </div>
                )}
                {c.status === "draft" && c.agent_id && c.phone_config_id && (
                  <Button size="sm" className="w-full mt-2" onClick={(e) => { e.stopPropagation(); startCampaign(c.id); }} disabled={runningCampaign === c.id}>
                    {runningCampaign === c.id ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</> : <><Play className="h-4 w-4 mr-2" /> Start Campaign</>}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
