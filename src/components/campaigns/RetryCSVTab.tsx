import * as React from "react";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, ShieldCheck, RefreshCw, Search, Clock, ArrowLeft } from "lucide-react";

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

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-blue-100 text-blue-800",
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
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

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

  // Build phone -> campaign/contact mapping
  const phoneToCampaigns = new Map<string, { campaign: Campaign; contact: Contact }[]>();
  for (const contact of contacts) {
    const campaign = campaigns.find((c) => c.id === contact.campaign_id);
    if (campaign) {
      const existing = phoneToCampaigns.get(contact.phone_number) || [];
      existing.push({ campaign, contact });
      phoneToCampaigns.set(contact.phone_number, existing);
    }
  }

  // Compute attempt numbers per phone
  const phoneCallCounts: Record<string, number> = {};
  const attemptMap: Record<string, number> = {};
  const sortedLogs = [...callLogs].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  for (const cl of sortedLogs) {
    const phone = cl.recipient_number || "";
    phoneCallCounts[phone] = (phoneCallCounts[phone] || 0) + 1;
    attemptMap[cl.id] = phoneCallCounts[phone];
  }

  // All retry calls
  const retryCalls = callLogs.filter((cl) => (attemptMap[cl.id] || 1) > 1);

  // Group retry calls by campaign
  const retryByCampaign = new Map<string, { campaign: Campaign; calls: CallLog[] }>();
  for (const cl of retryCalls) {
    const infos = cl.recipient_number ? phoneToCampaigns.get(cl.recipient_number) : null;
    const campaignId = infos?.[0]?.campaign.id || "unknown";
    const campaign = infos?.[0]?.campaign;
    if (!campaign) continue;
    if (!retryByCampaign.has(campaignId)) {
      retryByCampaign.set(campaignId, { campaign, calls: [] });
    }
    retryByCampaign.get(campaignId)!.calls.push(cl);
  }

  const dncPhones = new Set(dncList.map((d) => d.phone_number));

  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  // ─── Campaign Detail View ───
  if (selectedCampaign) {
    const campData = retryByCampaign.get(selectedCampaign.id);
    const campRetryCalls = campData?.calls || [];
    const campContacts = contacts.filter((c) => c.campaign_id === selectedCampaign.id);

    const getContactForLog = (cl: CallLog) => campContacts.find((c) => c.phone_number === cl.recipient_number);

    // Outcome counts
    const counts: Record<string, number> = {};
    for (const cl of campRetryCalls) {
      const r = getCallResult(cl);
      counts[r] = (counts[r] || 0) + 1;
    }

    const filteredLogs = campRetryCalls.filter((cl) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const contact = getContactForLog(cl);
      return (cl.recipient_number || "").toLowerCase().includes(term) ||
        (contact?.first_name || "").toLowerCase().includes(term);
    });

    const handleExportCSV = () => {
      const retryable = campRetryCalls.filter((cl) => {
        const result = getCallResult(cl);
        return (result === "VOICEMAIL" || result === "NO ANSWER") && !dncPhones.has(cl.recipient_number || "");
      });
      if (retryable.length === 0) {
        toast({ title: "No retryable contacts", description: "All retry calls were answered or are on the DNC list.", variant: "destructive" });
        return;
      }
      const headers = ["phone_number", "first_name", "child_names", "venue_name", "attempt", "last_result"];
      const rows = retryable.map((cl) => {
        const contact = getContactForLog(cl);
        return [cl.recipient_number || "", contact?.first_name || "", contact?.child_names || "", selectedCampaign.venue_name, attemptMap[cl.id] || 1, getCallResult(cl)].join(",");
      });
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedCampaign.venue_name.replace(/\s+/g, "_")}_retry.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Retry CSV downloaded" });
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedCampaign(null); setSearchTerm(""); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{selectedCampaign.venue_name}</h2>
              <Badge className={STATUS_COLORS[selectedCampaign.status] || ""} variant="secondary">{selectedCampaign.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{campRetryCalls.length} retry calls</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleExportCSV}>
            <Download className="h-4 w-4" /> Download Retry CSV
          </Button>
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { key: "ANSWERED", label: "ANSWERED" },
            { key: "VOICEMAIL", label: "VOICEMAIL" },
            { key: "NO ANSWER", label: "NO ANSWER" },
            { key: "FAILED", label: "FAILED" },
          ].map(({ key, label }) => (
            <Card key={key}>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-2xl font-bold">{counts[key] || 0}</p>
                <Badge className={`${OUTCOME_COLORS[key] || "bg-muted text-muted-foreground"} mt-1`} variant="secondary">{label}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, phone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>

        <Card>
          <CardContent className="p-0">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No retry calls for this campaign.</div>
            ) : (
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.slice(0, 100).map((cl) => {
                      const contact = getContactForLog(cl);
                      const result = getCallResult(cl);
                      const attempt = attemptMap[cl.id] || 1;
                      return (
                        <TableRow key={cl.id}>
                          <TableCell className="text-xs">{new Date(cl.started_at).toLocaleString()}</TableCell>
                          <TableCell className="text-sm font-medium">{contact?.first_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{cl.recipient_number || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">Retry #{attempt}</Badge></TableCell>
                          <TableCell><Badge className={OUTCOME_COLORS[result] || "bg-muted text-muted-foreground"} variant="secondary">{result}</Badge></TableCell>
                          <TableCell className="text-sm flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground" /> {formatDuration(cl.duration)}</TableCell>
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
      </div>
    );
  }

  // ─── Campaign Cards View ───
  const campaignEntries = Array.from(retryByCampaign.entries());

  return (
    <div className="space-y-6">
      {campaigns.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No campaigns found.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => {
            const campData = retryByCampaign.get(campaign.id);
            const retryCount = campData?.calls.length || 0;
            return (
              <Card key={campaign.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedCampaign(campaign)}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{campaign.venue_name}</CardTitle>
                    <Badge className={STATUS_COLORS[campaign.status] || ""} variant="secondary">{campaign.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{retryCount} retry calls</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Do-Not-Call List</CardTitle>
          <CardDescription>{dncList.length} numbers on the global do-not-call list. Automatically excluded from retry CSVs.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
