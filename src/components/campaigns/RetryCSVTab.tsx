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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw, Search, Clock, ArrowLeft, Phone, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Campaign {
  id: string;
  venue_name: string;
  round: number;
  status: string;
  agent_id: string | null;
  phone_config_id: string | null;
  created_at?: string;
}
interface CallLog {
  id: string; status: string; duration: number | null; started_at: string;
  recipient_number: string | null; transcript: any; summary: string | null;
}
interface Contact { id?: string; campaign_id: string; phone_number: string; first_name: string; child_names: string | null; }
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

const normalizeComparablePhone = (raw: string | null | undefined) =>
  String(raw || "").replace(/\D/g, "");

export default function RetryCSVTab() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dncList, setDncList] = useState<DNCEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [retryCampaignId, setRetryCampaignId] = useState<string>("");
  const [retrying, setRetrying] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editName, setEditName] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [campaignsRes, callLogsRes, contactsRes, dncRes] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, venue_name, round, status, agent_id, phone_config_id, created_at")
        .order("created_at", { ascending: false }),
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => fetchData())
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

  // Build phone -> campaign/contact mapping (with normalization)
  const phoneToCampaigns = new Map<string, { campaign: Campaign; contact: Contact }[]>();
  for (const contact of contacts) {
    const campaign = campaigns.find((c) => c.id === contact.campaign_id);
    if (campaign) {
      const normalized = normalizeComparablePhone(contact.phone_number);
      const existing = phoneToCampaigns.get(normalized) || [];
      existing.push({ campaign, contact });
      phoneToCampaigns.set(normalized, existing);
    }
  }

  // Compute attempt numbers per phone (with normalization)
  const phoneCallCounts: Record<string, number> = {};
  const attemptMap: Record<string, number> = {};
  const sortedLogs = [...callLogs].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  for (const cl of sortedLogs) {
    const phone = normalizeComparablePhone(cl.recipient_number);
    if (!phone) continue;
    phoneCallCounts[phone] = (phoneCallCounts[phone] || 0) + 1;
    attemptMap[cl.id] = phoneCallCounts[phone];
  }

  // All retry calls
  const retryCalls = callLogs.filter((cl) => (attemptMap[cl.id] || 1) > 1);

  // Group retry calls by campaign using better attribution (with normalization)
  const retryByCampaign = new Map<string, { campaign: Campaign; calls: CallLog[] }>();
  for (const cl of retryCalls) {
    const normalized = normalizeComparablePhone(cl.recipient_number);
    const infos = normalized ? phoneToCampaigns.get(normalized) : null;
    if (!infos || infos.length === 0) continue;
    
    // Attribute the call to the campaign that was created most recently *before* the call started
    const callTime = new Date(cl.started_at).getTime();
    let bestCampaign = infos[0].campaign;
    let minDiff = Infinity;
    
    for (const info of infos) {
      const campTime = new Date(info.campaign.created_at || 0).getTime();
      const diff = callTime - campTime;
      // We want the most recent campaign (smallest positive diff)
      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        bestCampaign = info.campaign;
      }
    }
    
    const campaignId = bestCampaign.id;
    if (!retryByCampaign.has(campaignId)) {
      retryByCampaign.set(campaignId, { campaign: bestCampaign, calls: [] });
    }
    retryByCampaign.get(campaignId)!.calls.push(cl);
  }

  const dncPhones = new Set(dncList.map((d) => d.phone_number));

  useEffect(() => {
    // Only update selectedCampaign from retryCampaignId if it's set
    // This prevents the "flash and close" glitch when fetchData runs in the background
    if (retryCampaignId) {
      const campaign = campaigns.find((c) => c.id === retryCampaignId) || null;
      if (campaign) setSelectedCampaign(campaign);
    }
  }, [retryCampaignId, campaigns]);

  // Move live sync interval to top level for real-time updates everywhere (cards + detail)
  useEffect(() => {
    if (!user) return;
    
    let cancelled = false;
    const refresh = async () => {
      await supabase.functions.invoke("sync-call-data").catch(() => null);
      if (!cancelled) {
        await fetchData();
      }
    };

    const interval = window.setInterval(refresh, 10000); // Sync every 10s
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user, fetchData]);

  const handleRetryCalls = async () => {
    if (!retryCampaignId || !user) return;
    setRetrying(true);
    try {
      const campaign = campaigns.find((c) => c.id === retryCampaignId);
      if (!campaign) throw new Error("Campaign not found");

      if (!campaign.agent_id || !campaign.phone_config_id) {
        toast({ title: "Campaign not configured", description: "Please assign an agent and phone number to this campaign in the Campaigns tab before retrying.", variant: "destructive" });
        setRetrying(false);
        return;
      }
      const campContacts = contacts.filter((c) => c.campaign_id === retryCampaignId);
      const retryPhones = new Set(
        campContacts
          .filter((c) => !dncPhones.has(c.phone_number))
          .map((c) => c.phone_number),
      );
      const retryContactIds = Array.from(retryPhones);

      if (retryContactIds.length === 0) {
        toast({ title: "No contacts to retry", description: "This campaign has no callable contacts.", variant: "destructive" });
        return;
      }

      // Find full contact rows to copy into a new retry campaign
      const { data: contactRows, error: contactRowsError } = await supabase
        .from("contacts")
        .select("*")
        .eq("campaign_id", retryCampaignId)
        .in("phone_number", Array.from(retryPhones));

      if (contactRowsError) throw contactRowsError;

      if (!contactRows || contactRows.length === 0) {
        toast({ title: "No contacts found", variant: "destructive" });
        return;
      }

      // Create a new retry campaign cloned from the selected one
      const retryRound = (campaign.round || 1) + 1;
      const retryVenueName = `${campaign.venue_name} - Retry ${retryRound}`;
      const { data: newCampaign, error: createCampaignError } = await supabase
        .from("campaigns")
        .insert({
          user_id: user.id,
          venue_name: retryVenueName,
          venue_location: null,
          round: retryRound,
          status: "draft",
          age_range: null,
          times: null,
          start_date: null,
          end_date: null,
          booking_target: null,
          notes: `Retry campaign created from ${campaign.venue_name}`,
          agent_id: campaign.agent_id,
          phone_config_id: campaign.phone_config_id,
          delay_seconds: 30,
          calls_made: 0,
          total_contacts: contactRows.length,
        })
        .select("id, venue_name, round, status, agent_id, phone_config_id, created_at")
        .single();

      if (createCampaignError || !newCampaign) {
        throw createCampaignError || new Error("Failed to create retry campaign");
      }

      const contactsToInsert = contactRows.map((contact: any) => {
        const {
          id: _id,
          campaign_id: _campaignId,
          created_at: _createdAt,
          updated_at: _updatedAt,
          ...rest
        } = contact;

        return {
          ...rest,
          campaign_id: newCampaign.id,
          user_id: contact.user_id || user.id,
        };
      });

      const { data: insertedContacts, error: insertContactsError } = await supabase
        .from("contacts")
        .insert(contactsToInsert)
        .select("id");

      if (insertContactsError) {
        throw insertContactsError;
      }

      const { data, error } = await supabase.functions.invoke("run-campaign", {
        body: { campaign_id: newCampaign.id, contact_ids: (insertedContacts || []).map((c) => c.id) },
      });
      if (error) throw error;
      setCampaigns((prev) => {
        const next = [newCampaign as Campaign, ...prev.filter((campaign) => campaign.id !== newCampaign.id)];
        next.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        return next;
      });
      await fetchData();
      setRetryCampaignId(newCampaign.id);
      setSelectedCampaign(newCampaign as Campaign);
      toast({
        title: "Retry campaign started",
        description: `Created ${newCampaign.venue_name} and queued ${contactRows.length} contacts`,
      });
    } catch (err: any) {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    } finally {
      setRetrying(false);
    }
  };
  const handleUpdateCampaignName = async () => {
    if (!editingCampaign || !editName.trim() || !user) return;
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ venue_name: editName.trim() })
        .eq("id", editingCampaign.id);

      if (error) throw error;
      
      toast({ title: "Campaign updated" });
      setEditingCampaign(null);
      await fetchData();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteCampaign = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This will also delete all associated contacts and data.`)) return;
    
    try {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;

      toast({ title: "Campaign deleted" });
      if (selectedCampaign?.id === id) setSelectedCampaign(null);
      await fetchData();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };


  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  // ─── Campaign Detail View ───
  if (selectedCampaign) {
    const campContacts = contacts.filter((c) => c.campaign_id === selectedCampaign.id);
    const campPhoneDigits = new Set(campContacts.map((contact) => normalizeComparablePhone(contact.phone_number)));
    const campaignCreatedAt = new Date(selectedCampaign.created_at || 0).getTime();
    const campRetryCalls = callLogs.filter((cl) => {
      if (!cl.recipient_number) return false;
      if (!campPhoneDigits.has(normalizeComparablePhone(cl.recipient_number))) return false;
      return new Date(cl.started_at).getTime() >= campaignCreatedAt;
    });

    // Outcome counts
    const counts: Record<string, number> = {};
    for (const cl of campRetryCalls) {
      const r = getCallResult(cl);
      counts[r] = (counts[r] || 0) + 1;
    }

    const filteredContacts = campContacts.filter((contact) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (contact.phone_number || "").toLowerCase().includes(term) ||
        (contact.first_name || "").toLowerCase().includes(term) ||
        (contact.child_names || "").toLowerCase().includes(term);
    });

    const handleExportCSV = () => {
      const exportable = campContacts.filter((contact) => !dncPhones.has(contact.phone_number || ""));
      if (exportable.length === 0) {
        toast({ title: "No contacts to export", description: "This campaign has no callable contacts.", variant: "destructive" });
        return;
      }
      const headers = ["phone_number", "first_name", "child_names", "venue_name"];
      const rows = exportable.map((contact) => {
        return [contact.phone_number || "", contact.first_name || "", contact.child_names || "", selectedCampaign.venue_name].join(",");
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
          <Button variant="ghost" size="icon" onClick={() => { 
            setSelectedCampaign(null); 
            setRetryCampaignId(""); // Reset this too to fix the glitch
            setSearchTerm(""); 
          }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">{selectedCampaign.venue_name}</h2>
              <Badge className={STATUS_COLORS[selectedCampaign.status] || ""} variant="secondary">{selectedCampaign.status}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{campContacts.length} contacts in this campaign</p>
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
            {filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No contacts found for this campaign.</div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Children</TableHead>
                      <TableHead>Latest Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredContacts.slice(0, 100).map((contact) => {
                      const contactPhone = normalizeComparablePhone(contact.phone_number);
                      const latestLog = campRetryCalls
                        .filter((cl) => normalizeComparablePhone(cl.recipient_number) === contactPhone)
                        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
                      const result = latestLog ? getCallResult(latestLog) : "PENDING";
                      return (
                        <TableRow key={`${selectedCampaign.id}-${contact.phone_number}`}>
                          <TableCell className="text-sm font-medium">{contact.first_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{contact.phone_number || "—"}</TableCell>
                          <TableCell className="text-sm">{contact.child_names || "—"}</TableCell>
                          <TableCell><Badge className={OUTCOME_COLORS[result] || "bg-muted text-muted-foreground"} variant="secondary">{result}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredContacts.length > 100 && <p className="text-xs text-muted-foreground p-3">Showing 100 of {filteredContacts.length}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleRetryCalls} disabled={retrying}>
            <Phone className={`h-4 w-4 mr-2 ${retrying ? "animate-pulse" : ""}`} />
            {retrying ? "Retrying..." : "Retry Calls"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Campaign Cards View ───

  return (
    <div className="space-y-6">
      {/* Select campaign & retry bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[200px] space-y-1">
              <p className="text-sm font-medium">Select Campaign to Retry</p>
              <Select value={retryCampaignId} onValueChange={setRetryCampaignId}>
                <SelectTrigger><SelectValue placeholder="Choose a campaign..." /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.venue_name}{c.round > 1 ? ` (Retry ${c.round})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleRetryCalls} disabled={!retryCampaignId || retrying}>
              <Phone className={`h-4 w-4 mr-2 ${retrying ? "animate-pulse" : ""}`} />
              {retrying ? "Retrying..." : "Retry Calls"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {campaigns.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No campaigns found.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => {
            const campData = retryByCampaign.get(campaign.id);
            const retryCount = campData?.calls.length || 0;
            return (
              <Card 
                key={campaign.id} 
                className="cursor-pointer hover:shadow-md transition-shadow" 
                onClick={() => {
                  setSelectedCampaign(campaign);
                  setRetryCampaignId(campaign.id);
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{campaign.venue_name}</CardTitle>
                      {campaign.round > 1 && (
                        <Badge variant="outline" className="shrink-0">Retry {campaign.round}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={STATUS_COLORS[campaign.status] || ""} variant="secondary">{campaign.status}</Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => {
                            setEditingCampaign(campaign);
                            setEditName(campaign.venue_name);
                          }}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteCampaign(campaign.id, campaign.venue_name)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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

      {/* Edit Dialog */}
      <Dialog open={!!editingCampaign} onOpenChange={(open) => !open && setEditingCampaign(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>Rename your campaign to keep your outreach organized.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Campaign Name</Label>
              <Input 
                id="campaign-name" 
                value={editName} 
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter campaign name..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCampaign(null)} disabled={updating}>Cancel</Button>
            <Button onClick={handleUpdateCampaignName} disabled={updating || !editName.trim()}>
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
