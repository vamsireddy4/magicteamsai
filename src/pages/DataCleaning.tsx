import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Users, Phone, Play, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ParsedContact {
  id: string;
  phone_number: string;
  first_name: string;
  child_names: string;
  venue_name: string;
  venue_location: string;
  start_date: string;
  end_date: string;
  times: string;
  age_range: string;
}

interface AgentRow { id: string; name: string; }
interface PhoneConfigRow { id: string; phone_number: string; friendly_name: string | null; provider: string; }

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+)/g)?.map((v) => v.trim().replace(/^"|"$/g, "")) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = values[i] || ""));
    return row;
  });
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "");
}

let idCounter = 0;
function genId() { return `c_${++idCounter}_${Date.now()}`; }

export default function DataCleaning() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [customerFile, setCustomerFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<{ total: number; bookedRemoved: number; dupsConsolidated: number } | null>(null);

  // Bulk call config
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<PhoneConfigRow[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedPhoneConfig, setSelectedPhoneConfig] = useState("");
  const [delaySec, setDelaySec] = useState("30");
  const [calling, setCalling] = useState(false);

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCustomerFile(file);
  };

  const processFiles = useCallback(async () => {
    if (!customerFile) {
      toast({ title: "Missing file", description: "Upload the customer CSV.", variant: "destructive" });
      return;
    }
    setProcessing(true);
    try {
      const customerText = await customerFile.text();
      const customers = parseCSV(customerText);
      const bookingsText = bookingsFile ? await bookingsFile.text() : "";
      const bookings = bookingsText ? parseCSV(bookingsText) : [];

      const bookedPhones = new Set(
        bookings.map((b) => normalizePhone(b.phone_number || b.phone || "")).filter(Boolean)
      );

      const unbookedCustomers = customers.filter(
        (c) => !bookedPhones.has(normalizePhone(c.phone_number || c.phone || ""))
      );
      const bookedRemoved = customers.length - unbookedCustomers.length;

      // Consolidate duplicates by phone
      const grouped = new Map<string, { contact: Record<string, string>; children: Set<string> }>();
      let dupsFound = 0;
      for (const row of unbookedCustomers) {
        const phone = normalizePhone(row.phone_number || row.phone || "");
        const childName = row.child_name || row.child_names || row.child || "";
        if (grouped.has(phone)) {
          dupsFound++;
          if (childName) grouped.get(phone)!.children.add(childName);
        } else {
          const children = new Set<string>();
          if (childName) children.add(childName);
          grouped.set(phone, { contact: row, children });
        }
      }

      const parsed: ParsedContact[] = [];
      for (const [, { contact, children }] of grouped) {
        parsed.push({
          id: genId(),
          phone_number: normalizePhone(contact.phone_number || contact.phone || ""),
          first_name: contact.first_name || contact.name || contact.parent_name || "",
          child_names: Array.from(children).join(", "),
          venue_name: contact.venue_name || contact.venue || "",
          venue_location: contact.venue_location || contact.location || "",
          start_date: contact.start_date || "",
          end_date: contact.end_date || "",
          times: contact.times || contact.time || "",
          age_range: contact.age_range || "",
        });
      }

      setContacts(parsed);
      setSelectedIds(new Set(parsed.map((c) => c.id)));
      setStats({ total: customers.length, bookedRemoved, dupsConsolidated: dupsFound });
      toast({ title: "Processing complete", description: `${parsed.length} unique contacts extracted.` });
    } catch (err: any) {
      toast({ title: "Error processing files", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  }, [customerFile, bookingsFile, toast]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === contacts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(contacts.map((c) => c.id)));
  };

  const startBulkCalling = async () => {
    if (!user) return;
    const selected = contacts.filter((c) => selectedIds.has(c.id));
    if (selected.length === 0) {
      toast({ title: "No contacts selected", variant: "destructive" });
      return;
    }
    if (!selectedAgent || !selectedPhoneConfig) {
      toast({ title: "Select agent & phone number", variant: "destructive" });
      return;
    }

    setCalling(true);
    try {
      // Create campaign
      const venueName = selected[0]?.venue_name || "Bulk Campaign";
      const { data: campaign, error: campErr } = await supabase.from("campaigns").insert({
        user_id: user.id,
        venue_name: venueName,
        agent_id: selectedAgent,
        phone_config_id: selectedPhoneConfig,
        delay_seconds: parseInt(delaySec) || 30,
        status: "draft",
        total_contacts: selected.length,
      } as any).select("id").single();

      if (campErr || !campaign) throw campErr || new Error("Failed to create campaign");

      // Insert contacts
      const contactRows = selected.map((c) => ({
        campaign_id: campaign.id,
        user_id: user.id,
        phone_number: c.phone_number,
        first_name: c.first_name,
        child_names: c.child_names || null,
        venue_name: c.venue_name || null,
        venue_location: c.venue_location || null,
        start_date: c.start_date || null,
        end_date: c.end_date || null,
        times: c.times || null,
        age_range: c.age_range || null,
      }));

      const { error: contactErr } = await supabase.from("contacts").insert(contactRows as any);
      if (contactErr) throw contactErr;

      // Start campaign
      const { data, error } = await supabase.functions.invoke("run-campaign", {
        body: { campaign_id: campaign.id },
      });
      if (error) throw error;

      toast({ title: "Campaign started!", description: `Calling ${selected.length} contacts with ${parseInt(delaySec)}s delay.` });
    } catch (err: any) {
      toast({ title: "Error starting campaign", description: err.message, variant: "destructive" });
    } finally {
      setCalling(false);
    }
  };

  const reset = () => {
    setContacts([]);
    setSelectedIds(new Set());
    setStats(null);
    setCustomerFile(null);
    setBookingsFile(null);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Cleaning Tool</h1>
          <p className="text-muted-foreground mt-1">
            Upload customer &amp; bookings CSVs → clean, deduplicate → select contacts → start bulk calling.
          </p>
        </div>

        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" /> Customer List CSV
            </CardTitle>
            <CardDescription>Full export from Eequ/Playwaze — all parents</CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {customerFile ? customerFile.name : "Click to upload CSV"}
              </span>
              <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload("customers")} />
            </label>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={processFiles} disabled={processing || !customerFile}>
            {processing ? "Processing..." : "Process & Clean Data"}
          </Button>
          {contacts.length > 0 && (
            <Button variant="outline" onClick={reset}>Reset</Button>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-2xl font-bold">{stats.total}</p>
                    <p className="text-xs text-muted-foreground">Total Rows Uploaded</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold">{stats.bookedRemoved}</p>
                    <p className="text-xs text-muted-foreground">Already Booked (Removed)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-8 w-8 text-yellow-500" />
                  <div>
                    <p className="text-2xl font-bold">{stats.dupsConsolidated}</p>
                    <p className="text-xs text-muted-foreground">Duplicates Consolidated</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Contacts Table */}
        {contacts.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Extracted Contacts</CardTitle>
                <CardDescription>{selectedIds.size} of {contacts.length} selected</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedIds.size === contacts.length && contacts.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Children</TableHead>
                      <TableHead>Venue</TableHead>
                      <TableHead>Dates</TableHead>
                      <TableHead>Times</TableHead>
                      <TableHead>Age Range</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((c) => (
                      <TableRow key={c.id} className={selectedIds.has(c.id) ? "bg-primary/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={() => toggleSelect(c.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.phone_number}</TableCell>
                        <TableCell>{c.first_name}</TableCell>
                        <TableCell>
                          {c.child_names ? <Badge variant="secondary">{c.child_names}</Badge> : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{c.venue_name}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {c.start_date && `${c.start_date}${c.end_date ? ` → ${c.end_date}` : ""}`}
                        </TableCell>
                        <TableCell className="text-xs">{c.times}</TableCell>
                        <TableCell className="text-xs">{c.age_range}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bulk Call Config */}
        {contacts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" /> Start Bulk Calling
              </CardTitle>
              <CardDescription>
                Select an agent and phone number, then call {selectedIds.size} selected contacts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Agent *</Label>
                  <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                    <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Phone Number *</Label>
                  <Select value={selectedPhoneConfig} onValueChange={setSelectedPhoneConfig}>
                    <SelectTrigger><SelectValue placeholder="Select number" /></SelectTrigger>
                    <SelectContent>
                      {phoneConfigs.map((pc) => (
                        <SelectItem key={pc.id} value={pc.id}>
                          {pc.friendly_name || pc.phone_number} ({pc.provider})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Delay Between Calls (sec)</Label>
                  <Input type="number" value={delaySec} onChange={(e) => setDelaySec(e.target.value)} min={5} />
                </div>
              </div>
              <div className="mt-4">
                <Button
                  onClick={startBulkCalling}
                  disabled={calling || selectedIds.size === 0 || !selectedAgent || !selectedPhoneConfig}
                  size="lg"
                >
                  {calling ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting Campaign...</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Call {selectedIds.size} Contacts</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
