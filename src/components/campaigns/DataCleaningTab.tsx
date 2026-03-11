import * as React from "react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, Phone, Play, Loader2, Sparkles, Save } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ColumnDef { key: string; label: string; type: "text" | "phone" | "date" | "number" | "email"; }
interface AgentRow { id: string; name: string; }
interface PhoneConfigRow { id: string; phone_number: string; friendly_name: string | null; provider: string; }

export default function DataCleaningTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [customerFile, setCustomerFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState("");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<PhoneConfigRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [campaignName, setCampaignName] = useState("");

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true),
      supabase.from("phone_configs").select("id, phone_number, friendly_name, provider").eq("is_active", true),
    ]).then(([{ data: ag }, { data: pc }]) => {
      setAgents(ag || []);
      setPhoneConfigs((pc as PhoneConfigRow[]) || []);
    });
  }, [user]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) setCustomerFile(file); };

  const processFile = async () => {
    if (!customerFile) { toast({ title: "Missing file", description: "Upload a CSV file first.", variant: "destructive" }); return; }
    setProcessing(true);
    try {
      const csvContent = await customerFile.text();
      const { data, error } = await supabase.functions.invoke("analyze-csv", { body: { csvContent } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Analysis failed");
      setColumns(data.columns || []); setRows(data.rows || []); setSummary(data.summary || "");
      setSelectedIndices(new Set((data.rows || []).map((_: any, i: number) => i)));
      toast({ title: "Analysis complete", description: data.summary || `${data.rows?.length || 0} contacts found.` });
    } catch (err: any) { toast({ title: "Error analyzing CSV", description: err.message, variant: "destructive" }); }
    finally { setProcessing(false); }
  };

  const toggleSelect = (idx: number) => { setSelectedIndices((prev) => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; }); };
  const toggleAll = () => { if (selectedIndices.size === rows.length) setSelectedIndices(new Set()); else setSelectedIndices(new Set(rows.map((_, i) => i))); };

  const phoneCol = columns.find((c) => c.type === "phone")?.key || columns.find((c) => c.key.toLowerCase().includes("phone"))?.key || "";
  const nameCol = columns.find((c) => c.key.toLowerCase().includes("name") && !c.key.toLowerCase().includes("child"))?.key || "";
  const emailCol = columns.find((c) => c.type === "email")?.key || columns.find((c) => c.key.toLowerCase().includes("email"))?.key || "";

  const saveContacts = async () => {
    if (!user) return;
    const selected = rows.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) { toast({ title: "No contacts selected", variant: "destructive" }); return; }
    const venueName = campaignName.trim() || selected[0]?.venue_name || selected[0]?.venue || "Bulk Campaign";
    setSaving(true);
    try {
      const { data: campaign, error: campErr } = await supabase.from("campaigns").insert({
        user_id: user.id, venue_name: venueName,
        agent_id: selectedAgent || null, phone_config_id: selectedPhoneConfig || null,
        delay_seconds: parseInt(delaySec) || 30, status: "draft", total_contacts: selected.length,
      } as any).select("id").single();
      if (campErr || !campaign) throw campErr || new Error("Failed to create campaign");
      const contactRows = selected.map((row) => ({
        campaign_id: campaign.id, user_id: user.id, phone_number: row[phoneCol] || "",
        first_name: row[nameCol] || row[Object.keys(row)[0]] || "", child_names: row.child_names || row.child_name || row.children || null,
        venue_name: row.venue_name || row.venue || null, venue_location: row.venue_location || row.location || null,
        start_date: row.start_date || null, end_date: row.end_date || null, times: row.times || row.time || null, age_range: row.age_range || null,
      }));
      const { error: contactErr } = await supabase.from("contacts").insert(contactRows as any);
      if (contactErr) throw contactErr;
      toast({ title: "Contacts saved!", description: `${selected.length} contacts saved to campaign "${venueName}". Go to the Campaigns tab to start calling.` });
      reset();
    } catch (err: any) { toast({ title: "Error saving contacts", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const startBulkCalling = async () => {
    if (!user) return;
    const selected = rows.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) { toast({ title: "No contacts selected", variant: "destructive" }); return; }
    if (!selectedAgent || !selectedPhoneConfig) { toast({ title: "Select agent & phone number", variant: "destructive" }); return; }
    if (!phoneCol) { toast({ title: "No phone column detected", variant: "destructive" }); return; }
    setCalling(true);
    try {
      const venueName = campaignName.trim() || selected[0]?.venue_name || selected[0]?.venue || "Bulk Campaign";
      const { data: campaign, error: campErr } = await supabase.from("campaigns").insert({
        user_id: user.id, venue_name: venueName, agent_id: selectedAgent, phone_config_id: selectedPhoneConfig,
        delay_seconds: parseInt(delaySec) || 30, status: "draft", total_contacts: selected.length,
      } as any).select("id").single();
      if (campErr || !campaign) throw campErr || new Error("Failed to create campaign");
      const contactRows = selected.map((row) => ({
        campaign_id: campaign.id, user_id: user.id, phone_number: row[phoneCol] || "",
        first_name: row[nameCol] || row[Object.keys(row)[0]] || "", child_names: row.child_names || row.child_name || row.children || null,
        venue_name: row.venue_name || row.venue || null, venue_location: row.venue_location || row.location || null,
        start_date: row.start_date || null, end_date: row.end_date || null, times: row.times || row.time || null, age_range: row.age_range || null,
      }));
      const { error: contactErr } = await supabase.from("contacts").insert(contactRows as any);
      if (contactErr) throw contactErr;
      const { error } = await supabase.functions.invoke("run-campaign", { body: { campaign_id: campaign.id } });
      if (error) throw error;
      toast({ title: "Campaign started!", description: `Calling ${selected.length} contacts.` });
    } catch (err: any) { toast({ title: "Error starting campaign", description: err.message, variant: "destructive" }); }
    finally { setCalling(false); }
  };

  const reset = () => { setColumns([]); setRows([]); setSelectedIndices(new Set()); setSummary(""); setCustomerFile(null); setCampaignName(""); };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4" /> Upload CSV</CardTitle>
          <CardDescription>Upload any contacts CSV — AI will detect columns and clean the data</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{customerFile ? customerFile.name : "Click to upload CSV"}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={processFile} disabled={processing || !customerFile}>
          {processing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing with AI...</> : <><Sparkles className="h-4 w-4 mr-2" /> Process &amp; Analyze</>}
        </Button>
        {rows.length > 0 && <Button variant="outline" onClick={reset}>Reset</Button>}
      </div>

      {summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">AI Analysis</p>
                <p className="text-sm text-muted-foreground mt-1">{summary}</p>
                <div className="flex gap-4 mt-2">
                  <Badge variant="secondary">{rows.length} contacts</Badge>
                  <Badge variant="secondary">{columns.length} fields detected</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div><CardTitle>Extracted Contacts</CardTitle><CardDescription>{selectedIndices.size} of {rows.length} selected</CardDescription></div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"><Checkbox checked={selectedIndices.size === rows.length && rows.length > 0} onCheckedChange={toggleAll} /></TableHead>
                    {columns.map((col) => <TableHead key={col.key}>{col.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={selectedIndices.has(i) ? "bg-primary/5" : ""}>
                      <TableCell><Checkbox checked={selectedIndices.has(i)} onCheckedChange={() => toggleSelect(i)} /></TableCell>
                      {columns.map((col) => <TableCell key={col.key} className={col.type === "phone" ? "font-mono text-xs" : "text-sm"}>{row[col.key] || "—"}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Save className="h-5 w-5" /> Save & Start Calling</CardTitle>
            <CardDescription>Save {selectedIndices.size} selected contacts to a campaign, or start calling immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2"><Label>Campaign Name</Label><Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. My Bulk Campaign" /></div>
              <div className="space-y-2"><Label>Agent</Label><Select value={selectedAgent} onValueChange={setSelectedAgent}><SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger><SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Phone Number</Label><Select value={selectedPhoneConfig} onValueChange={setSelectedPhoneConfig}><SelectTrigger><SelectValue placeholder="Select number" /></SelectTrigger><SelectContent>{phoneConfigs.map((pc) => <SelectItem key={pc.id} value={pc.id}>{pc.friendly_name || pc.phone_number} ({pc.provider})</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Delay Between Calls (sec)</Label><Input type="number" value={delaySec} onChange={(e) => setDelaySec(e.target.value)} min={5} /></div>
            </div>
            <div className="mt-4 flex gap-3">
              <Button variant="outline" onClick={saveContacts} disabled={saving || selectedIndices.size === 0}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save Contacts</>}
              </Button>
              <Button onClick={startBulkCalling} disabled={calling || selectedIndices.size === 0 || !selectedAgent || !selectedPhoneConfig}>
                {calling ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting Campaign...</> : <><Play className="h-4 w-4 mr-2" /> Save &amp; Call {selectedIndices.size} Contacts</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
