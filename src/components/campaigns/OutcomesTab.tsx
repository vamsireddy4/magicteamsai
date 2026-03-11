import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, FileText, RefreshCw, Loader2 } from "lucide-react";

interface Outcome { id: string; campaign_id: string; phone_number: string; parent_name: string | null; child_names: string | null; venue_name: string | null; outcome: string; transcript: string | null; summary: string | null; attempt_number: number; call_timestamp: string; }
interface Campaign { id: string; venue_name: string; round: number; }

const OUTCOME_COLORS: Record<string, string> = { ANSWERED: "bg-green-100 text-green-800", DECLINED: "bg-red-100 text-red-800", FLAGGED_REVIEW: "bg-yellow-100 text-yellow-800", VOICEMAIL: "bg-blue-100 text-blue-800", NO_ANSWER: "bg-muted text-muted-foreground", PENDING: "bg-muted text-muted-foreground" };
const OUTCOMES = ["ALL", "ANSWERED", "DECLINED", "NO_ANSWER", "PENDING", "VOICEMAIL", "FLAGGED_REVIEW"];

export default function OutcomesTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVenue, setFilterVenue] = useState("ALL");
  const [filterOutcome, setFilterOutcome] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ campaign_id: "", phone_number: "", parent_name: "", child_names: "", venue_name: "", outcome: "PENDING", transcript: "", summary: "", attempt_number: "1" });
  const [syncing, setSyncing] = useState(false);

  const syncCallData = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("sync-call-data");
      if (error) throw error;
      toast({ title: "Calls synced" });
      await fetchData();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally { setSyncing(false); }
  };

  const fetchData = async () => {
    if (!user) return;
    const [outcomesRes, campaignsRes] = await Promise.all([
      supabase.from("call_outcomes").select("*").order("call_timestamp", { ascending: false }),
      supabase.from("campaigns").select("id, venue_name, round"),
    ]);
    setOutcomes((outcomesRes.data as Outcome[]) || []);
    setCampaigns((campaignsRes.data as Campaign[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleAddOutcome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const { error } = await supabase.from("call_outcomes").insert({
      user_id: user.id, campaign_id: addForm.campaign_id, phone_number: addForm.phone_number,
      parent_name: addForm.parent_name || null, child_names: addForm.child_names || null,
      venue_name: addForm.venue_name || null, outcome: addForm.outcome, transcript: addForm.transcript || null,
      summary: addForm.summary || null, attempt_number: parseInt(addForm.attempt_number) || 1,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Outcome added" });
      if (addForm.outcome === "ANSWERED" || addForm.outcome === "DECLINED") {
        await supabase.from("do_not_call").insert({ user_id: user.id, phone_number: addForm.phone_number, reason: addForm.outcome, parent_name: addForm.parent_name || null, venue_name: addForm.venue_name || null });
      }
      setAddDialogOpen(false);
      setAddForm({ campaign_id: "", phone_number: "", parent_name: "", child_names: "", venue_name: "", outcome: "PENDING", transcript: "", summary: "", attempt_number: "1" });
      fetchData();
    }
  };

  const venues = [...new Set(outcomes.map((o) => o.venue_name).filter(Boolean))] as string[];
  const filtered = outcomes.filter((o) => {
    if (filterVenue !== "ALL" && o.venue_name !== filterVenue) return false;
    if (filterOutcome !== "ALL" && o.outcome !== filterOutcome) return false;
    if (searchTerm) { const term = searchTerm.toLowerCase(); return o.phone_number.toLowerCase().includes(term) || (o.parent_name || "").toLowerCase().includes(term) || (o.child_names || "").toLowerCase().includes(term); }
    return true;
  });
  const outcomeCounts = outcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={syncCallData} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Sync & Refresh
        </Button>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <Button onClick={() => setAddDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add Outcome</Button>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Call Outcome</DialogTitle></DialogHeader>
            <form onSubmit={handleAddOutcome} className="space-y-4">
              <div className="space-y-2"><Label>Campaign</Label><Select value={addForm.campaign_id} onValueChange={(v) => { const camp = campaigns.find((c) => c.id === v); setAddForm({ ...addForm, campaign_id: v, venue_name: camp?.venue_name || "" }); }}><SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger><SelectContent>{campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.venue_name} (R{c.round})</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Phone Number *</Label><Input value={addForm.phone_number} onChange={(e) => setAddForm({ ...addForm, phone_number: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Outcome *</Label><Select value={addForm.outcome} onValueChange={(v) => setAddForm({ ...addForm, outcome: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{OUTCOMES.filter((o) => o !== "ALL").map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Parent Name</Label><Input value={addForm.parent_name} onChange={(e) => setAddForm({ ...addForm, parent_name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Child Names</Label><Input value={addForm.child_names} onChange={(e) => setAddForm({ ...addForm, child_names: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Summary</Label><Textarea value={addForm.summary} onChange={(e) => setAddForm({ ...addForm, summary: e.target.value })} rows={2} /></div>
              <div className="space-y-2"><Label>Transcript</Label><Textarea value={addForm.transcript} onChange={(e) => setAddForm({ ...addForm, transcript: e.target.value })} rows={3} /></div>
              <Button type="submit">Save Outcome</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {["ANSWERED", "DECLINED", "NO_ANSWER", "PENDING", "VOICEMAIL", "FLAGGED_REVIEW"].map((o) => (
          <Card key={o} className="cursor-pointer hover:shadow-sm transition-shadow" onClick={() => setFilterOutcome(filterOutcome === o ? "ALL" : o)}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-2xl font-bold">{outcomeCounts[o] || 0}</p>
              <Badge className={`${OUTCOME_COLORS[o]} mt-1`} variant="secondary">{o.replace("_", " ")}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, phone, children..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <Select value={filterVenue} onValueChange={setFilterVenue}><SelectTrigger className="w-[180px]"><SelectValue placeholder="All Venues" /></SelectTrigger><SelectContent><SelectItem value="ALL">All Venues</SelectItem>{venues.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select>
        <Select value={filterOutcome} onValueChange={setFilterOutcome}><SelectTrigger className="w-[160px]"><SelectValue placeholder="All Outcomes" /></SelectTrigger><SelectContent>{OUTCOMES.map((o) => <SelectItem key={o} value={o}>{o === "ALL" ? "All Outcomes" : o}</SelectItem>)}</SelectContent></Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <div className="p-8 text-center text-muted-foreground">Loading...</div>
          : filtered.length === 0 ? <div className="p-8 text-center text-muted-foreground">No outcomes found.</div>
          : (
            <div className="overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Venue</TableHead><TableHead>Parent</TableHead><TableHead>Phone</TableHead><TableHead>Children</TableHead><TableHead>Outcome</TableHead><TableHead>Attempt</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map((o) => (
                    <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedOutcome(o)}>
                      <TableCell className="text-xs">{new Date(o.call_timestamp).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{o.venue_name || "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{o.parent_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{o.phone_number}</TableCell>
                      <TableCell className="text-sm">{o.child_names || "—"}</TableCell>
                      <TableCell><Badge className={OUTCOME_COLORS[o.outcome] || ""} variant="secondary">{o.outcome}</Badge></TableCell>
                      <TableCell className="text-center">{o.attempt_number}</TableCell>
                      <TableCell>{(o.transcript || o.summary) && <FileText className="h-4 w-4 text-muted-foreground" />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length > 100 && <p className="text-xs text-muted-foreground p-3">Showing 100 of {filtered.length}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOutcome} onOpenChange={(open) => !open && setSelectedOutcome(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Call Detail</DialogTitle></DialogHeader>
          {selectedOutcome && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Parent:</span> {selectedOutcome.parent_name || "—"}</div>
                <div><span className="text-muted-foreground">Phone:</span> {selectedOutcome.phone_number}</div>
                <div><span className="text-muted-foreground">Venue:</span> {selectedOutcome.venue_name || "—"}</div>
                <div><span className="text-muted-foreground">Attempt:</span> {selectedOutcome.attempt_number}</div>
                <div><span className="text-muted-foreground">Children:</span> {selectedOutcome.child_names || "—"}</div>
                <div><span className="text-muted-foreground">Outcome:</span> <Badge className={OUTCOME_COLORS[selectedOutcome.outcome]}>{selectedOutcome.outcome}</Badge></div>
              </div>
              {selectedOutcome.summary && <div><p className="text-sm font-medium mb-1">Summary</p><p className="text-sm text-muted-foreground">{selectedOutcome.summary}</p></div>}
              {selectedOutcome.transcript && <div><p className="text-sm font-medium mb-1">Transcript</p><pre className="text-xs bg-muted p-3 rounded-lg whitespace-pre-wrap max-h-60 overflow-y-auto">{selectedOutcome.transcript}</pre></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
