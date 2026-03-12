import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, FileText, RefreshCw, Loader2, ArrowLeft, MapPin, Calendar, Users, Target, Phone, Clock } from "lucide-react";

interface Outcome {
  id: string; campaign_id: string; phone_number: string; parent_name: string | null;
  child_names: string | null; venue_name: string | null; outcome: string;
  transcript: string | null; summary: string | null; attempt_number: number;
  call_timestamp: string; contact_id: string | null;
}

interface Campaign {
  id: string; venue_name: string; venue_location: string | null; round: number;
  age_range: string | null; times: string | null; start_date: string | null;
  end_date: string | null; booking_target: number | null; status: string;
  notes: string | null; calls_made: number; total_contacts: number;
}

interface CallLog {
  id: string; status: string; duration: number | null; started_at: string;
  ended_at: string | null; recipient_number: string | null; caller_number: string | null;
  direction: string; transcript: any; ultravox_call_id: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-blue-100 text-blue-800",
};

const OUTCOME_COLORS: Record<string, string> = {
  ANSWERED: "bg-green-100 text-green-800", DECLINED: "bg-red-100 text-red-800",
  FLAGGED_REVIEW: "bg-yellow-100 text-yellow-800", VOICEMAIL: "bg-blue-100 text-blue-800",
  NO_ANSWER: "bg-muted text-muted-foreground", PENDING: "bg-muted text-muted-foreground",
};

const OUTCOMES = ["ALL", "ANSWERED", "DECLINED", "NO_ANSWER", "PENDING", "VOICEMAIL", "FLAGGED_REVIEW"];

export default function OutcomesTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [contacts, setContacts] = useState<{ campaign_id: string; phone_number: string; first_name: string; child_names: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Drill-down state
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [filterOutcome, setFilterOutcome] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCallLog, setSelectedCallLog] = useState<CallLog | null>(null);

  // Add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ campaign_id: "", phone_number: "", parent_name: "", child_names: "", venue_name: "", outcome: "PENDING", transcript: "", summary: "", attempt_number: "1" });

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
    const [outcomesRes, campaignsRes, callLogsRes, contactsRes] = await Promise.all([
      supabase.from("call_outcomes").select("*").order("call_timestamp", { ascending: false }),
      supabase.from("campaigns").select("id, venue_name, venue_location, round, age_range, times, start_date, end_date, booking_target, status, notes, calls_made, total_contacts").order("created_at", { ascending: false }),
      supabase.from("call_logs").select("*").order("started_at", { ascending: false }),
      supabase.from("contacts").select("campaign_id, phone_number, first_name, child_names"),
    ]);
    setOutcomes((outcomesRes.data as Outcome[]) || []);
    setCampaigns((campaignsRes.data as Campaign[]) || []);
    setCallLogs((callLogsRes.data as CallLog[]) || []);
    setContacts(contactsRes.data || []);
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

  // Helpers
  const getOutcomesForCampaign = (campaignId: string) => outcomes.filter((o) => o.campaign_id === campaignId);

  const getOutcomeCounts = (campaignOutcomes: Outcome[]) =>
    campaignOutcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] || 0) + 1; return acc; }, {} as Record<string, number>);

  const CALL_STATUS_COLORS: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    "no-answer": "bg-muted text-muted-foreground",
    busy: "bg-yellow-100 text-yellow-800",
    failed: "bg-red-100 text-red-800",
    canceled: "bg-muted text-muted-foreground",
    initiated: "bg-blue-100 text-blue-800",
    "in-progress": "bg-blue-100 text-blue-800",
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatTranscript = (transcript: any): string | null => {
    if (!transcript) return null;
    if (Array.isArray(transcript)) {
      return transcript.map((t: any) => `${t.role || "unknown"}: ${t.text || ""}`).join("\n");
    }
    if (typeof transcript === "string") return transcript;
    return JSON.stringify(transcript, null, 2);
  };

  // ─── Campaign Detail View ───
  if (selectedCampaign) {
    // Get phone numbers for this campaign's contacts
    const campContacts = contacts.filter((c) => c.campaign_id === selectedCampaign.id);
    const campPhones = new Set(campContacts.map((c) => c.phone_number));

    // Get call logs matching campaign contacts
    const campCallLogs = callLogs.filter((cl) => cl.recipient_number && campPhones.has(cl.recipient_number));

    // Status counts
    const statusCounts = campCallLogs.reduce((acc, cl) => {
      acc[cl.status] = (acc[cl.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Search filter
    const filteredLogs = campCallLogs.filter((cl) => {
      if (filterOutcome !== "ALL") {
        if (filterOutcome === "ANSWERED" && !(cl.status === "completed" && (cl.duration || 0) > 10)) return false;
        if (filterOutcome === "VOICEMAIL" && !(cl.status === "completed" && (cl.duration || 0) <= 10)) return false;
        if (filterOutcome === "NO_ANSWER" && !["no-answer", "canceled", "busy"].includes(cl.status)) return false;
        if (filterOutcome === "DECLINED" && cl.status !== "failed") return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const contact = campContacts.find((c) => c.phone_number === cl.recipient_number);
        return (cl.recipient_number || "").toLowerCase().includes(term) ||
          (contact?.first_name || "").toLowerCase().includes(term) ||
          (contact?.child_names || "").toLowerCase().includes(term);
      }
      return true;
    });

    const getContactForLog = (cl: CallLog) => campContacts.find((c) => c.phone_number === cl.recipient_number);

    const getCallResult = (cl: CallLog) => {
      if (cl.status === "completed" && (cl.duration || 0) > 10) return "ANSWERED";
      if (cl.status === "completed" && (cl.duration || 0) <= 10) return "VOICEMAIL";
      if (["no-answer", "canceled", "busy"].includes(cl.status)) return "NO ANSWER";
      if (cl.status === "failed") return "FAILED";
      return cl.status.toUpperCase();
    };

    return (
      <div className="space-y-6">
        {/* Back + Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedCampaign(null); setFilterOutcome("ALL"); setSearchTerm(""); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{selectedCampaign.venue_name}</h2>
              <Badge className={STATUS_COLORS[selectedCampaign.status] || ""} variant="secondary">{selectedCampaign.status}</Badge>
              <Badge variant="outline">Round {selectedCampaign.round}</Badge>
            </div>
            {selectedCampaign.venue_location && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" /> {selectedCampaign.venue_location}</p>
            )}
          </div>
          <Button variant="outline" onClick={syncCallData} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sync & Refresh
          </Button>
        </div>

        {/* Outcome Summary Cards */}
        {(() => {
          const campOutcomes = getOutcomesForCampaign(selectedCampaign.id);
          const campOutcomeCounts = getOutcomeCounts(campOutcomes);
          return (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {["ANSWERED", "DECLINED", "NO_ANSWER", "PENDING", "VOICEMAIL", "FLAGGED_REVIEW"].map((o) => (
                <Card key={o} className={`cursor-pointer hover:shadow-sm transition-shadow ${filterOutcome === o ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setFilterOutcome(filterOutcome === o ? "ALL" : o)}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold">{campOutcomeCounts[o] || 0}</p>
                    <Badge className={`${OUTCOME_COLORS[o]} mt-1`} variant="secondary">{o.replace("_", " ")}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          );
        })()}

        {/* Search & Filter */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name, phone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <Select value={filterOutcome} onValueChange={setFilterOutcome}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Results" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Results</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="VOICEMAIL">Voicemail</SelectItem>
              <SelectItem value="NO_ANSWER">No Answer</SelectItem>
              <SelectItem value="DECLINED">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Call Results Table */}
        <Card>
          <CardContent className="p-0">
            {filteredLogs.length === 0 ? <div className="p-8 text-center text-muted-foreground">No call results for this campaign.</div> : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 100).map((cl) => {
                      const contact = getContactForLog(cl);
                      const result = getCallResult(cl);
                      return (
                        <TableRow key={cl.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCallLog(cl)}>
                          <TableCell className="text-xs">{new Date(cl.started_at).toLocaleString()}</TableCell>
                          <TableCell className="text-sm font-medium">{contact?.first_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{cl.recipient_number || "—"}</TableCell>
                          <TableCell><Badge className={CALL_STATUS_COLORS[cl.status] || "bg-muted text-muted-foreground"} variant="secondary">{cl.status}</Badge></TableCell>
                          <TableCell><Badge className={OUTCOME_COLORS[result] || "bg-muted text-muted-foreground"} variant="secondary">{result}</Badge></TableCell>
                          <TableCell className="text-sm flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground" /> {formatDuration(cl.duration)}</TableCell>
                          <TableCell>{cl.transcript && <FileText className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredLogs.length > 100 && <p className="text-xs text-muted-foreground p-3">Showing 100 of {filteredLogs.length}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Call Detail Dialog */}
        <Dialog open={!!selectedCallLog} onOpenChange={(open) => !open && setSelectedCallLog(null)}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Call Detail</DialogTitle></DialogHeader>
            {selectedCallLog && (() => {
              const contact = getContactForLog(selectedCallLog);
              const transcriptText = formatTranscript(selectedCallLog.transcript);
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Contact:</span> {contact?.first_name || "—"}</div>
                    <div><span className="text-muted-foreground">Phone:</span> {selectedCallLog.recipient_number || "—"}</div>
                    <div><span className="text-muted-foreground">Children:</span> {contact?.child_names || "—"}</div>
                    <div><span className="text-muted-foreground">Status:</span> <Badge className={CALL_STATUS_COLORS[selectedCallLog.status]}>{selectedCallLog.status}</Badge></div>
                    <div><span className="text-muted-foreground">Result:</span> <Badge className={OUTCOME_COLORS[getCallResult(selectedCallLog)] || ""}>{getCallResult(selectedCallLog)}</Badge></div>
                    <div><span className="text-muted-foreground">Duration:</span> {formatDuration(selectedCallLog.duration)}</div>
                    <div><span className="text-muted-foreground">Started:</span> {new Date(selectedCallLog.started_at).toLocaleString()}</div>
                    {selectedCallLog.ended_at && <div><span className="text-muted-foreground">Ended:</span> {new Date(selectedCallLog.ended_at).toLocaleString()}</div>}
                    <div><span className="text-muted-foreground">Direction:</span> {selectedCallLog.direction}</div>
                    {selectedCallLog.caller_number && <div><span className="text-muted-foreground">From:</span> {selectedCallLog.caller_number}</div>}
                  </div>
                  {transcriptText && <div><p className="text-sm font-medium mb-1">Transcript</p><pre className="text-xs bg-muted p-3 rounded-lg whitespace-pre-wrap max-h-60 overflow-y-auto">{transcriptText}</pre></div>}
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── Campaign List View ───
  const allOutcomeCounts = outcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] || 0) + 1; return acc; }, {} as Record<string, number>);

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


      {/* Campaign Cards */}
      {loading ? <div className="p-8 text-center text-muted-foreground">Loading...</div>
        : campaigns.length === 0 ? <div className="p-8 text-center text-muted-foreground">No campaigns found.</div>
        : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((camp) => {
              const campOutcomes = getOutcomesForCampaign(camp.id);
              const counts = getOutcomeCounts(campOutcomes);
              const progress = camp.total_contacts > 0 ? Math.round((camp.calls_made / camp.total_contacts) * 100) : 0;

              return (
                <Card key={camp.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedCampaign(camp)}>
                  <CardContent className="pt-5 pb-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-base">{camp.venue_name}</h3>
                        {camp.venue_location && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" /> {camp.venue_location}</p>}
                      </div>
                      <div className="flex gap-1.5">
                        <Badge className={STATUS_COLORS[camp.status] || ""} variant="secondary">{camp.status}</Badge>
                        <Badge variant="outline">R{camp.round}</Badge>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{camp.calls_made} / {camp.total_contacts} calls</span>
                        <span>{progress}%</span>
                      </div>
                      <Progress value={progress} className="h-1.5" />
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {["ANSWERED", "DECLINED", "NO_ANSWER", "PENDING", "VOICEMAIL", "FLAGGED_REVIEW"].map((o) =>
                        (counts[o] || 0) > 0 ? (
                          <Badge key={o} className={`${OUTCOME_COLORS[o]} text-[10px] px-1.5 py-0`} variant="secondary">
                            {o.replace("_", " ")} {counts[o]}
                          </Badge>
                        ) : null
                      )}
                      {campOutcomes.length === 0 && <span className="text-xs text-muted-foreground">No outcomes yet</span>}
                    </div>

                    <div className="flex gap-3 text-xs text-muted-foreground pt-1 border-t">
                      {camp.age_range && <span>{camp.age_range}</span>}
                      {camp.times && <span>{camp.times}</span>}
                      {camp.start_date && <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{camp.start_date}</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
    </div>
  );
}
