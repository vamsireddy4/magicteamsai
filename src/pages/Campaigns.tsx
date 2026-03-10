import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Phone, Target, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-primary/10 text-primary",
};

const emptyForm = {
  venue_name: "",
  venue_location: "",
  start_date: "",
  end_date: "",
  times: "",
  age_range: "",
  round: 1,
  status: "draft",
  booking_target: "",
  twilio_phone_number: "",
  elevenlabs_campaign_id: "",
  notes: "",
};

export default function Campaigns() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState("all");

  const fetchCampaigns = async () => {
    if (!user) return;
    const { data } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
    setCampaigns((data as Campaign[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchCampaigns(); }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const payload = {
      user_id: user.id,
      venue_name: form.venue_name,
      venue_location: form.venue_location || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      times: form.times || null,
      age_range: form.age_range || null,
      round: form.round,
      status: form.status,
      booking_target: form.booking_target ? parseInt(form.booking_target) : null,
      twilio_phone_number: form.twilio_phone_number || null,
      elevenlabs_campaign_id: form.elevenlabs_campaign_id || null,
      notes: form.notes || null,
    };

    const { error } = editingId
      ? await supabase.from("campaigns").update(payload).eq("id", editingId)
      : await supabase.from("campaigns").insert(payload);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingId ? "Campaign updated" : "Campaign created" });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      fetchCampaigns();
    }
  };

  const editCampaign = (c: Campaign) => {
    setEditingId(c.id);
    setForm({
      venue_name: c.venue_name,
      venue_location: c.venue_location || "",
      start_date: c.start_date || "",
      end_date: c.end_date || "",
      times: c.times || "",
      age_range: c.age_range || "",
      round: c.round,
      status: c.status,
      booking_target: c.booking_target?.toString() || "",
      twilio_phone_number: c.twilio_phone_number || "",
      elevenlabs_campaign_id: c.elevenlabs_campaign_id || "",
      notes: c.notes || "",
    });
    setDialogOpen(true);
  };

  const deleteCampaign = async (id: string) => {
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Campaign deleted" }); fetchCampaigns(); }
  };

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);

  const statusCounts = campaigns.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
            <p className="text-muted-foreground mt-1">Manage venue calling campaigns across rounds.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingId(null); setForm(emptyForm); } }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> New Campaign</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Campaign" : "New Campaign"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Venue Name *</Label>
                  <Input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} required />
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Location</Label>
                    <Input value={form.venue_location} onChange={(e) => setForm({ ...form, venue_location: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Age Range</Label>
                    <Input value={form.age_range} onChange={(e) => setForm({ ...form, age_range: e.target.value })} placeholder="e.g. 5-12" />
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Times</Label>
                    <Input value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} placeholder="e.g. 9am-3pm" />
                  </div>
                  <div className="space-y-2">
                    <Label>Booking Target</Label>
                    <Input type="number" value={form.booking_target} onChange={(e) => setForm({ ...form, booking_target: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-4 grid-cols-2">
                  <div className="space-y-2">
                    <Label>Round</Label>
                    <Select value={String(form.round)} onValueChange={(v) => setForm({ ...form, round: parseInt(v) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Round 1</SelectItem>
                        <SelectItem value="2">Round 2</SelectItem>
                        <SelectItem value="3">Round 3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Twilio Phone Number</Label>
                  <Input value={form.twilio_phone_number} onChange={(e) => setForm({ ...form, twilio_phone_number: e.target.value })} placeholder="+44..." />
                </div>
                <div className="space-y-2">
                  <Label>ElevenLabs Campaign ID</Label>
                  <Input value={form.elevenlabs_campaign_id} onChange={(e) => setForm({ ...form, elevenlabs_campaign_id: e.target.value })} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
                <div className="flex gap-3">
                  <Button type="submit">{editingId ? "Update" : "Create"}</Button>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {["all", "draft", "active", "paused", "completed"].map((s) => (
            <Button key={s} variant={filter === s ? "default" : "outline"} size="sm" onClick={() => setFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== "all" && statusCounts[s] ? ` (${statusCounts[s]})` : s === "all" ? ` (${campaigns.length})` : ""}
            </Button>
          ))}
        </div>

        {/* Campaign Grid */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}><CardContent className="h-40 animate-pulse bg-muted/50 rounded-lg" /></Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No campaigns yet. Create one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <Card key={c.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{c.venue_name}</CardTitle>
                      {c.venue_location && (
                        <CardDescription className="flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3" /> {c.venue_location}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => editCampaign(c)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteCampaign(c.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
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
                    {c.twilio_phone_number && (
                      <p className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.twilio_phone_number}</p>
                    )}
                    {c.booking_target && (
                      <p className="flex items-center gap-1"><Target className="h-3 w-3" /> Target: {c.booking_target}</p>
                    )}
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
