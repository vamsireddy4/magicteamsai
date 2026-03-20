import * as React from "react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, Loader2, Sparkles, Save } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { analyzeCsvWithGemini } from "@/lib/gemini";

interface ColumnDef { key: string; label: string; type: "text" | "phone" | "date" | "number" | "email"; }

export default function DataCleaningTab() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [customerFile, setCustomerFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [campaignName, setCampaignName] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) setCustomerFile(file); };

  const processFile = async () => {
    if (!customerFile) { toast({ title: "Missing file", description: "Upload a CSV file first.", variant: "destructive" }); return; }
    setProcessing(true);
    try {
      const csvContent = await customerFile.text();
      const data = await analyzeCsvWithGemini(csvContent, profile?.gemini_api_key, profile?.analysis_model);
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

  const saveContacts = async () => {
    if (!user) return;
    const selected = rows.filter((_, i) => selectedIndices.has(i));
    if (selected.length === 0) { toast({ title: "No contacts selected", variant: "destructive" }); return; }
    if (!campaignName.trim()) { toast({ title: "Enter a campaign name", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const { data: campaign, error: campErr } = await supabase.from("campaigns").insert({
        user_id: user.id, venue_name: campaignName.trim(),
        status: "draft", total_contacts: selected.length,
      } as any).select("id").single();
      if (campErr || !campaign) throw campErr || new Error("Failed to create campaign");
      const contactRows = selected.map((row) => ({
        campaign_id: campaign.id, user_id: user.id, phone_number: row[phoneCol] || "",
        first_name: row[nameCol] || row[Object.keys(row)[0]] || "", child_names: row.child_names || row.child_name || row.children || null,
        venue_name: row.venue_name || row.venue || null, venue_location: row.venue_location || row.location || null,
        start_date: row.start_date || null, end_date: row.end_date || null, times: row.times || row.time || null, age_range: row.age_range || null,
        metadata: row,
      }));
      const { error: contactErr } = await supabase.from("contacts").insert(contactRows as any);
      if (contactErr) throw contactErr;
      toast({ title: "Contacts saved!", description: `${selected.length} contacts saved to campaign "${campaignName.trim()}". Go to the Campaigns tab to select contacts and start calling.` });
      reset();
    } catch (err: any) { toast({ title: "Error saving contacts", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
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
            <CardTitle className="flex items-center gap-2"><Save className="h-5 w-5" /> Save to Campaign</CardTitle>
            <CardDescription>Save {selectedIndices.size} selected contacts to a new campaign. You can start calling from the Campaigns tab.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="space-y-2 flex-1 max-w-sm">
                <Label>Campaign Name *</Label>
                <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. My Bulk Campaign" />
              </div>
              <Button onClick={saveContacts} disabled={saving || selectedIndices.size === 0 || !campaignName.trim()}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : <><Save className="h-4 w-4 mr-2" /> Save {selectedIndices.size} Contacts</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
