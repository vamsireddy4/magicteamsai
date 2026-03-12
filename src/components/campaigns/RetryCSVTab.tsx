import * as React from "react";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, ShieldCheck, RefreshCw, AlertTriangle, Search, Clock } from "lucide-react";

interface Campaign { id: string; venue_name: string; round: number; status: string; }
interface CallLog {
  id: string; status: string; duration: number | null; started_at: string;
  recipient_number: string | null; transcript: any; summary: string | null;
}
interface Contact { campaign_id: string; phone_number: string; first_name: string; child_names: string | null; }
interface DNCEntry { phone_number: string; }

const OUTCOME_COLORS: Record<string, string> = {
  ANSWERED: "bg-green-100 text-green-800",
  VOICEMAIL: "bg-blue-100 text-blue-800",
  "NO ANSWER": "bg-muted text-muted-foreground",
  FAILED: "bg-red-100 text-red-800",
  PENDING: "bg-muted text-muted-foreground",
};

export default function RetryCSVTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dncList, setDncList] = useState<DNCEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCampaign, setFilterCampaign] = useState("all");

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [campaignsRes, callLogsRes, contactsRes, dncRes] = await Promise.all([
      supabase.from("campaigns").select("id, venue_name, round, status").order("venue_name"),
      supabase.from("call_logs").select("id, status, duration, started_at, recipient_number, transcript, summary").order("started_at", { ascending: false }),
      supabase.from("contacts").select("campaign_id, phone_number, first_name, child_names"),
      supabase.from("do_not_call").select("phone_number"),
    ]);
    setCampaigns((campaignsRes.data as Campaign[]) || []);
    setCallLogs((callLogsRes.data as CallLog[]) || []);
    setContacts((contactsRes.data as Contact[]) || []);
    setDncList((dncRes.data as DNCEntry[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('retry-csv-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const getCallResult = (cl: CallLog) => {
    if (cl.status === "completed" && (cl.duration || 0) > 10) return "ANSWERED";
    if (cl.status === "completed" && (cl.duration || 0) <= 10) return "VOICEMAIL";
    if (["no-answer", "canceled", "busy"].includes(cl.status)) return "NO ANSWER";
    if (cl.status === "failed") return "FAILED";
    if (["initiated", "in-progress", "ringing", "queued"].includes(cl.status)) return "PENDING";
    return cl.status.toUpperCase();
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "0s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  // Build a map of campaign_id -> campaign for each contact's phone
  const phoneToCampaign = new Map<string, { campaign: Campaign; contact: Contact }>();
  for (const contact of contacts) {
    const campaign = campaigns.find((c) => c.id === contact.campaign_id);
    if (campaign) {
      phoneToCampaign.set(contact.phone_number, { campaign, contact });
    }
  }

  // Compute attempt numbers per phone and identify retry calls (attempt > 1)
  const phoneCallCounts: Record<string, number> = {};
  const attemptMap: Record<string, number> = {};
  const sortedLogs = [...callLogs].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  for (const cl of sortedLogs) {
    const phone = cl.recipient_number || "";
    phoneCallCounts[phone] = (phoneCallCounts[phone] || 0) + 1;
    attemptMap[cl.id] = phoneCallCounts[phone];
  }

  // Filter to only retry calls (attempt > 1)
  const retryCalls = callLogs.filter((cl) => (attemptMap[cl.id] || 1) > 1);

  // Apply filters
  const filteredRetryCalls = retryCalls.filter((cl) => {
    const info = cl.recipient_number ? phoneToCampaign.get(cl.recipient_number) : null;
    if (filterCampaign !== "all" && info?.campaign.id !== filterCampaign) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (cl.recipient_number || "").toLowerCase().includes(term) ||
        (info?.contact.first_name || "").toLowerCase().includes(term) ||
        (info?.campaign.venue_name || "").toLowerCase().includes(term);
    }
    return true;
  });

  // Stats
  const retryOutcomeCounts: Record<string, number> = {};
  for (const cl of retryCalls) {
    const result = getCallResult(cl);
    retryOutcomeCounts[result] = (retryOutcomeCounts[result] || 0) + 1;
  }

  const dncPhones = new Set(dncList.map((d) => d.phone_number));

  // Generate retry CSV for unanswered retry contacts
  const downloadRetryCSV = () => {
    const retryable = retryCalls.filter((cl) => {
      const result = getCallResult(cl);
      return (result === "VOICEMAIL" || result === "NO ANSWER") && !dncPhones.has(cl.recipient_number || "");
    });
    if (retryable.length === 0) {
      toast({ title: "No retryable contacts", description: "All retry calls were answered or are on the DNC list.", variant: "destructive" });
      return;
    }
    const headers = ["phone_number", "first_name", "child_names", "venue_name", "campaign", "attempt", "last_result"];
    const rows = retryable.map((cl) => {
      const info = cl.recipient_number ? phoneToCampaign.get(cl.recipient_number) : null;
      const result = getCallResult(cl);
      return [
        cl.recipient_number || "",
        info?.contact.first_name || "",
        info?.contact.child_names?.includes(",") ? `"${info.contact.child_names}"` : info?.contact.child_names || "",
        info?.campaign.venue_name || "",
        info?.campaign.venue_name || "",
        attemptMap[cl.id] || 1,
        result,
      ].join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retry_calls_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Retry CSV downloaded" });
  };

  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{retryCalls.length}</p>
            <p className="text-xs text-muted-foreground">Total Retry Calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{retryOutcomeCounts["ANSWERED"] || 0}</p>
            <Badge className="bg-green-100 text-green-800 mt-1" variant="secondary">ANSWERED</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{retryOutcomeCounts["VOICEMAIL"] || 0}</p>
            <Badge className="bg-blue-100 text-blue-800 mt-1" variant="secondary">VOICEMAIL</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{retryOutcomeCounts["NO ANSWER"] || 0}</p>
            <Badge className="bg-muted text-muted-foreground mt-1" variant="secondary">NO ANSWER</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Search, Filter, Download */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, phone, campaign..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <Select value={filterCampaign} onValueChange={setFilterCampaign}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All Campaigns" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Campaigns</SelectItem>
            {campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.venue_name} (R{c.round})</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={downloadRetryCSV} disabled={retryCalls.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Download Retry CSV
        </Button>
      </div>

      {/* Retry Calls Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retry Call Results ({filteredRetryCalls.length})</CardTitle>
          <CardDescription>All calls where the contact was called more than once (attempt #2+).</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filteredRetryCalls.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No retry calls found.</div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRetryCalls.slice(0, 100).map((cl) => {
                    const info = cl.recipient_number ? phoneToCampaign.get(cl.recipient_number) : null;
                    const result = getCallResult(cl);
                    const attempt = attemptMap[cl.id] || 1;
                    return (
                      <TableRow key={cl.id}>
                        <TableCell className="text-xs">{new Date(cl.started_at).toLocaleString()}</TableCell>
                        <TableCell className="text-sm font-medium">{info?.campaign.venue_name || "—"}</TableCell>
                        <TableCell className="text-sm">{info?.contact.first_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{cl.recipient_number || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">Retry #{attempt}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={OUTCOME_COLORS[result] || "bg-muted text-muted-foreground"} variant="secondary">{result}</Badge>
                        </TableCell>
                        <TableCell className="text-sm flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" /> {formatDuration(cl.duration)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filteredRetryCalls.length > 100 && <p className="text-xs text-muted-foreground p-3">Showing 100 of {filteredRetryCalls.length}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DNC Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Do-Not-Call List</CardTitle>
          <CardDescription>{dncList.length} numbers on the global do-not-call list. These are automatically excluded from retry CSVs.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
