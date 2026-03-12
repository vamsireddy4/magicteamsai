import * as React from "react";
import { useEffect, useState, useCallback } from "react";
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
import { Plus, Search, Loader2, ArrowLeft, MapPin, Calendar, Clock, Sparkles, Download } from "lucide-react";

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
  direction: string; transcript: any; ultravox_call_id: string | null; summary: string | null;
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
  "NO ANSWER": "bg-muted text-muted-foreground", FAILED: "bg-red-100 text-red-800",
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

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [filterOutcome, setFilterOutcome] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCallLog, setSelectedCallLog] = useState<CallLog | null>(null);

  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState({ campaign_id: "", phone_number: "", parent_name: "", child_names: "", venue_name: "", outcome: "PENDING", transcript: "", summary: "", attempt_number: "1" });

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [outcomesRes, campaignsRes, callLogsRes, contactsRes] = await Promise.all([
      supabase.from("call_outcomes").select("*").order("call_timestamp", { ascending: false }),
      supabase.from("campaigns").select("id, venue_name, venue_location, round, age_range, times, start_date, end_date, booking_target, status, notes, calls_made, total_contacts").order("created_at", { ascending: false }),
      supabase.from("call_logs").select("*").order("started_at", { ascending: false }),
      supabase.from("contacts").select("campaign_id, phone_number, first_name, child_names"),
    ]);
    setOutcomes((outcomesRes.data as Outcome[]) || []);
    setCampaigns((campaignsRes.data as Campaign[]) || []);
    const logs = (callLogsRes.data as CallLog[]) || [];
    setCallLogs(logs);
    setContacts(contactsRes.data || []);
    // Load persisted summaries from call_logs
    const savedSummaries: Record<string, string> = {};
    for (const log of logs) {
      if (log.summary) savedSummaries[log.id] = log.summary;
    }
    setSummaries((prev) => ({ ...savedSummaries, ...prev }));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('outcomes-call-logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_outcomes' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

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
    }
  };

  const handleSummarize = async (callLogId: string) => {
    setSummarizing((prev) => ({ ...prev, [callLogId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("summarize-call", { body: { call_id: callLogId } });
      if (error) throw error;
      const summaryText = data?.summary || "No summary generated.";
      setSummaries((prev) => ({ ...prev, [callLogId]: summaryText }));
      // Persist to database
      await supabase.from("call_logs").update({ summary: summaryText } as any).eq("id", callLogId);
      toast({ title: "Summary generated & saved" });
    } catch (err: any) {
      toast({ title: "Summary failed", description: err.message, variant: "destructive" });
    } finally {
      setSummarizing((prev) => ({ ...prev, [callLogId]: false }));
    }
  };

  const getOutcomesForCampaign = (campaignId: string) => outcomes.filter((o) => o.campaign_id === campaignId);
  const getOutcomeCounts = (campOutcomes: Outcome[]) =>
    campOutcomes.reduce((acc, o) => { acc[o.outcome] = (acc[o.outcome] || 0) + 1; return acc; }, {} as Record<string, number>);

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

  const truncateText = (text: string | null, maxLen: number) => {
    if (!text) return null;
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  };

  const getCallResult = (cl: CallLog) => {
    if (cl.status === "completed" && (cl.duration || 0) > 10) return "ANSWERED";
    if (cl.status === "completed" && (cl.duration || 0) <= 10) return "VOICEMAIL";
    if (["no-answer", "canceled", "busy"].includes(cl.status)) return "NO ANSWER";
    if (cl.status === "failed") return "FAILED";
    if (["initiated", "in-progress", "ringing", "queued"].includes(cl.status)) return "PENDING";
    return cl.status.toUpperCase();
  };

  // ─── Campaign Detail View ───
  if (selectedCampaign) {
    const campContacts = contacts.filter((c) => c.campaign_id === selectedCampaign.id);
    const campPhones = new Set(campContacts.map((c) => c.phone_number));
    const campCallLogs = callLogs.filter((cl) => cl.recipient_number && campPhones.has(cl.recipient_number));

    // Attempt numbers
    const attemptMap: Record<string, number> = {};
    const phoneCallCounts: Record<string, number> = {};
    const sortedLogs = [...campCallLogs].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    for (const cl of sortedLogs) {
      const phone = cl.recipient_number || "";
      phoneCallCounts[phone] = (phoneCallCounts[phone] || 0) + 1;
      attemptMap[cl.id] = phoneCallCounts[phone];
    }

    // Filter out retry calls (attempt > 1) — those belong in the Retry CSV tab
    const firstAttemptLogs = campCallLogs.filter((cl) => (attemptMap[cl.id] || 1) === 1);

    // Compute outcome counts from first-attempt call_logs only
    const liveOutcomeCounts: Record<string, number> = {};
    for (const cl of firstAttemptLogs) {
      const result = getCallResult(cl);
      liveOutcomeCounts[result] = (liveOutcomeCounts[result] || 0) + 1;
    }

    // Filter
    const filteredLogs = campCallLogs.filter((cl) => {
      if (filterOutcome !== "ALL") {
        const result = getCallResult(cl);
        const filterMap: Record<string, string[]> = {
          ANSWERED: ["ANSWERED"],
          VOICEMAIL: ["VOICEMAIL"],
          NO_ANSWER: ["NO ANSWER"],
          DECLINED: ["FAILED", "DECLINED"],
          PENDING: ["PENDING"],
          FLAGGED_REVIEW: ["FLAGGED_REVIEW"],
        };
        if (filterMap[filterOutcome] && !filterMap[filterOutcome].includes(result)) return false;
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

    // Export to CSV
    const handleExportCSV = () => {
      const headers = ["Time", "Contact", "Phone", "Children", "Attempt", "Result", "Duration (s)", "Transcript", "AI Summary"];
      const rows = campCallLogs.map((cl) => {
        const contact = getContactForLog(cl);
        const result = getCallResult(cl);
        const transcriptText = formatTranscript(cl.transcript) || "";
        const summary = summaries[cl.id] || "";
        const attempt = attemptMap[cl.id] || 1;
        return [
          new Date(cl.started_at).toLocaleString(),
          contact?.first_name || "",
          cl.recipient_number || "",
          contact?.child_names || "",
          attempt > 1 ? `Retry #${attempt}` : "1st",
          result,
          cl.duration || 0,
          `"${transcriptText.replace(/"/g, '""')}"`,
          `"${summary.replace(/"/g, '""')}"`,
        ].join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedCampaign.venue_name}_outcomes.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported to CSV" });
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
            </div>
            {selectedCampaign.venue_location && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" /> {selectedCampaign.venue_location}</p>
            )}
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleExportCSV}>
            <Download className="h-4 w-4" /> Export to Sheets
          </Button>
        </div>

        {/* Outcome Summary Cards — computed from live call_logs */}
        <div className="grid gap-3 grid-cols-3">
          {[
            { key: "ANSWERED", label: "ANSWERED" },
            { key: "FAILED", label: "DECLINED" },
            { key: "NO ANSWER", label: "NO ANSWER" },
            { key: "PENDING", label: "PENDING" },
            { key: "VOICEMAIL", label: "VOICEMAIL" },
            { key: "FLAGGED_REVIEW", label: "FLAGGED REVIEW" },
          ].map(({ key, label }) => (
            <Card key={key} className={`cursor-pointer hover:shadow-sm transition-shadow ${filterOutcome === key ? "ring-2 ring-primary" : ""}`}
              onClick={() => setFilterOutcome(filterOutcome === key ? "ALL" : key)}>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold">{liveOutcomeCounts[key] || 0}</p>
                <Badge className={`${OUTCOME_COLORS[key] || "bg-muted text-muted-foreground"} mt-1`} variant="secondary">{label}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

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
              <SelectItem value="NO ANSWER">No Answer</SelectItem>
              <SelectItem value="DECLINED">Failed</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
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
                      <TableHead>Attempt</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Transcript</TableHead>
                      <TableHead>AI Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 100).map((cl) => {
                      const contact = getContactForLog(cl);
                      const result = getCallResult(cl);
                      const transcriptText = formatTranscript(cl.transcript);
                      const attempt = attemptMap[cl.id] || 1;
                      const summary = summaries[cl.id];
                      const isSummarizing = summarizing[cl.id];

                      return (
                        <TableRow key={cl.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCallLog(cl)}>
                          <TableCell className="text-xs">{new Date(cl.started_at).toLocaleString()}</TableCell>
                          <TableCell className="text-sm font-medium">{contact?.first_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{cl.recipient_number || "—"}</TableCell>
                          <TableCell>
                            {attempt > 1 ? (
                              <Badge variant="outline" className="text-xs">Retry #{attempt}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">1st</span>
                            )}
                          </TableCell>
                          <TableCell><Badge className={OUTCOME_COLORS[result] || "bg-muted text-muted-foreground"} variant="secondary">{result}</Badge></TableCell>
                          <TableCell className="text-sm whitespace-nowrap"><Clock className="h-3 w-3 text-muted-foreground inline mr-1" />{formatDuration(cl.duration)}</TableCell>
                          <TableCell className="max-w-[150px]">
                            {transcriptText ? (
                              <span className="text-xs text-muted-foreground line-clamp-2">{truncateText(transcriptText, 80)}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                            {summary ? (
                              <button
                                className="text-xs text-muted-foreground line-clamp-2 text-left hover:text-foreground transition-colors cursor-pointer"
                                onClick={() => setSelectedCallLog(cl)}
                              >
                                {truncateText(summary, 100)}
                              </button>
                            ) : transcriptText ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                disabled={isSummarizing}
                                onClick={() => handleSummarize(cl.id)}
                              >
                                {isSummarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                {isSummarizing ? "Generating..." : "Generate"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
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
              const summary = summaries[selectedCallLog.id];
              const attempt = attemptMap[selectedCallLog.id] || 1;
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
                    <div><span className="text-muted-foreground">Attempt:</span> {attempt > 1 ? `Retry #${attempt}` : "1st"}</div>
                    {selectedCallLog.caller_number && <div><span className="text-muted-foreground">From:</span> {selectedCallLog.caller_number}</div>}
                  </div>
                  {summary && (
                    <div>
                      <p className="text-sm font-medium mb-1">AI Summary</p>
                      <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg whitespace-pre-wrap">{summary}</p>
                    </div>
                  )}
                  {!summary && transcriptText && (
                    <Button variant="outline" size="sm" className="gap-1" disabled={summarizing[selectedCallLog.id]} onClick={() => handleSummarize(selectedCallLog.id)}>
                      {summarizing[selectedCallLog.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {summarizing[selectedCallLog.id] ? "Generating Summary..." : "Generate AI Summary"}
                    </Button>
                  )}
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
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <Button onClick={() => setAddDialogOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add Outcome</Button>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Call Outcome</DialogTitle></DialogHeader>
            <form onSubmit={handleAddOutcome} className="space-y-4">
              <div className="space-y-2"><Label>Campaign</Label><Select value={addForm.campaign_id} onValueChange={(v) => { const camp = campaigns.find((c) => c.id === v); setAddForm({ ...addForm, campaign_id: v, venue_name: camp?.venue_name || "" }); }}><SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger><SelectContent>{campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.venue_name}</SelectItem>)}</SelectContent></Select></div>
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
                      <Badge className={STATUS_COLORS[camp.status] || ""} variant="secondary">{camp.status}</Badge>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{camp.calls_made} / {camp.total_contacts} calls</span>
                        <span>{progress}%</span>
                      </div>
                      <Progress value={progress} className="h-1.5" />
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
