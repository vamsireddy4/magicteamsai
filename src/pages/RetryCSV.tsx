import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";

interface Campaign {
  id: string;
  venue_name: string;
  round: number;
  status: string;
}

interface Outcome {
  phone_number: string;
  parent_name: string | null;
  child_names: string | null;
  venue_name: string | null;
  outcome: string;
  attempt_number: number;
}

interface DNCEntry {
  phone_number: string;
}

export default function RetryCSV() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [retryContacts, setRetryContacts] = useState<Outcome[]>([]);
  const [dncList, setDncList] = useState<DNCEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [stats, setStats] = useState({ total: 0, voicemail: 0, noAnswer: 0, dncFiltered: 0 });

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("campaigns").select("id, venue_name, round, status").order("venue_name"),
      supabase.from("do_not_call").select("phone_number"),
    ]).then(([campaignsRes, dncRes]) => {
      setCampaigns((campaignsRes.data as Campaign[]) || []);
      setDncList((dncRes.data as DNCEntry[]) || []);
      setLoading(false);
    });
  }, [user]);

  const generateRetryList = async () => {
    if (!user) return;
    setGenerating(true);

    try {
      let query = supabase.from("call_outcomes").select("phone_number, parent_name, child_names, venue_name, outcome, attempt_number");

      if (selectedCampaign !== "all") {
        query = query.eq("campaign_id", selectedCampaign);
      }

      const { data: outcomes } = await query;
      if (!outcomes) { setGenerating(false); return; }

      const dncPhones = new Set(dncList.map((d) => d.phone_number));

      // Group by phone number, take latest outcome
      const byPhone = new Map<string, Outcome>();
      for (const o of outcomes as Outcome[]) {
        const existing = byPhone.get(o.phone_number);
        if (!existing || o.attempt_number > existing.attempt_number) {
          byPhone.set(o.phone_number, o);
        }
      }

      // Filter: only VOICEMAIL and NO_ANSWER, exclude DNC
      let dncFilteredCount = 0;
      const retryList: Outcome[] = [];

      for (const [phone, outcome] of byPhone) {
        if (outcome.outcome !== "VOICEMAIL" && outcome.outcome !== "NO_ANSWER") continue;
        if (dncPhones.has(phone)) {
          dncFilteredCount++;
          continue;
        }
        retryList.push(outcome);
      }

      setRetryContacts(retryList);
      setStats({
        total: byPhone.size,
        voicemail: retryList.filter((r) => r.outcome === "VOICEMAIL").length,
        noAnswer: retryList.filter((r) => r.outcome === "NO_ANSWER").length,
        dncFiltered: dncFilteredCount,
      });

      toast({ title: "Retry list generated", description: `${retryList.length} contacts ready for retry.` });
    } finally {
      setGenerating(false);
    }
  };

  const downloadCSV = () => {
    if (retryContacts.length === 0) return;

    const headers = ["phone_number", "language", "voice_id", "first_message", "first_name", "child_names", "venue_name", "venue_location", "start_date", "end_date", "times", "age_range", "sheet_reference"];
    const rows = retryContacts.map((c) =>
      [
        c.phone_number,
        "en", "", "",
        c.parent_name || "",
        c.child_names?.includes(",") ? `"${c.child_names}"` : c.child_names || "",
        c.venue_name || "",
        "", "", "", "", "",
        c.venue_name || "",
      ].join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const venueName = selectedCampaign !== "all"
      ? campaigns.find((c) => c.id === selectedCampaign)?.venue_name || "retry"
      : "all_venues";
    a.download = `${venueName.replace(/\s+/g, "_")}_retry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Retry CSV Generator</h1>
          <p className="text-muted-foreground mt-1">
            Generate retry CSVs for the next calling round — excludes BOOKED, DECLINED, and do-not-call numbers.
          </p>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate Retry List</CardTitle>
            <CardDescription>
              Filters outcomes to VOICEMAIL + NO_ANSWER only, cross-references the global do-not-call list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="space-y-2 flex-1 min-w-[200px]">
                <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                  <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Campaigns</SelectItem>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.venue_name} (R{c.round})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={generateRetryList} disabled={generating || loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
                {generating ? "Generating..." : "Generate"}
              </Button>
              {retryContacts.length > 0 && (
                <Button variant="outline" onClick={downloadCSV}>
                  <Download className="h-4 w-4 mr-2" /> Download CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        {retryContacts.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total Outcomes Processed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-blue-500" />
                  <div>
                    <p className="text-2xl font-bold">{stats.voicemail}</p>
                    <p className="text-xs text-muted-foreground">Voicemail (retry)</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 flex items-center gap-3">
                  <RefreshCw className="h-6 w-6 text-muted-foreground" />
                  <div>
                    <p className="text-2xl font-bold">{stats.noAnswer}</p>
                    <p className="text-xs text-muted-foreground">No Answer (retry)</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 flex items-center gap-3">
                  <ShieldCheck className="h-6 w-6 text-destructive" />
                  <div>
                    <p className="text-2xl font-bold">{stats.dncFiltered}</p>
                    <p className="text-xs text-muted-foreground">DNC Filtered Out</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Preview Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Retry Contacts ({retryContacts.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Phone</TableHead>
                        <TableHead>Parent</TableHead>
                        <TableHead>Children</TableHead>
                        <TableHead>Venue</TableHead>
                        <TableHead>Last Outcome</TableHead>
                        <TableHead>Attempts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {retryContacts.slice(0, 50).map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{c.phone_number}</TableCell>
                          <TableCell>{c.parent_name || "—"}</TableCell>
                          <TableCell>{c.child_names || "—"}</TableCell>
                          <TableCell>{c.venue_name || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={c.outcome === "VOICEMAIL" ? "bg-blue-100 text-blue-800" : ""}>{c.outcome}</Badge>
                          </TableCell>
                          <TableCell className="text-center">{c.attempt_number}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {retryContacts.length > 50 && (
                    <p className="text-xs text-muted-foreground p-3">Showing 50 of {retryContacts.length}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* DNC Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Do-Not-Call List
            </CardTitle>
            <CardDescription>
              {dncList.length} numbers on the global do-not-call list. These are automatically excluded from all retry CSVs.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </DashboardLayout>
  );
}
