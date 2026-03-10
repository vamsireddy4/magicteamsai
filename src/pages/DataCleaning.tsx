import * as React from "react";
import { useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileSpreadsheet, Trash2, CheckCircle, AlertCircle, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ParsedContact {
  phone_number: string;
  first_name: string;
  child_names: string;
  venue_name: string;
  venue_location: string;
  start_date: string;
  end_date: string;
  times: string;
  age_range: string;
  sheet_reference: string;
}

interface CleaningStats {
  totalCustomers: number;
  bookedRemoved: number;
  duplicatesConsolidated: number;
  finalContacts: number;
  venues: string[];
}

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

export default function DataCleaning() {
  const { toast } = useToast();
  const [customerFile, setCustomerFile] = useState<File | null>(null);
  const [bookingsFile, setBookingsFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [stats, setStats] = useState<CleaningStats | null>(null);
  const [cleanedData, setCleanedData] = useState<Map<string, ParsedContact[]>>(new Map());
  const [previewVenue, setPreviewVenue] = useState<string | null>(null);

  const handleFileUpload = (type: "customers" | "bookings") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (type === "customers") setCustomerFile(file);
    else setBookingsFile(file);
  };

  const processFiles = useCallback(async () => {
    if (!customerFile || !bookingsFile) {
      toast({ title: "Missing files", description: "Upload both customer and bookings CSVs.", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      const customerText = await customerFile.text();
      const bookingsText = await bookingsFile.text();

      const customers = parseCSV(customerText);
      const bookings = parseCSV(bookingsText);

      // Build set of booked phone numbers
      const bookedPhones = new Set(
        bookings.map((b) => normalizePhone(b.phone_number || b.phone || "")).filter(Boolean)
      );

      // Remove booked parents
      const unbookedCustomers = customers.filter(
        (c) => !bookedPhones.has(normalizePhone(c.phone_number || c.phone || ""))
      );
      const bookedRemoved = customers.length - unbookedCustomers.length;

      // Consolidate by phone number + venue
      const grouped = new Map<string, { contact: Record<string, string>; children: Set<string> }>();
      let dupsFound = 0;

      for (const row of unbookedCustomers) {
        const phone = normalizePhone(row.phone_number || row.phone || "");
        const venue = row.venue_name || row.venue || "";
        const key = `${phone}__${venue}`;
        const childName = row.child_name || row.child_names || row.child || "";

        if (grouped.has(key)) {
          dupsFound++;
          if (childName) grouped.get(key)!.children.add(childName);
        } else {
          const children = new Set<string>();
          if (childName) children.add(childName);
          grouped.set(key, { contact: row, children });
        }
      }

      // Organize by venue
      const byVenue = new Map<string, ParsedContact[]>();

      for (const [, { contact, children }] of grouped) {
        const venue = contact.venue_name || contact.venue || "Unknown";
        const parsed: ParsedContact = {
          phone_number: normalizePhone(contact.phone_number || contact.phone || ""),
          first_name: contact.first_name || contact.name || contact.parent_name || "",
          child_names: Array.from(children).join(", "),
          venue_name: venue,
          venue_location: contact.venue_location || contact.location || "",
          start_date: contact.start_date || "",
          end_date: contact.end_date || "",
          times: contact.times || contact.time || "",
          age_range: contact.age_range || "",
          sheet_reference: contact.sheet_reference || venue,
        };

        if (!byVenue.has(venue)) byVenue.set(venue, []);
        byVenue.get(venue)!.push(parsed);
      }

      setCleanedData(byVenue);
      setStats({
        totalCustomers: customers.length,
        bookedRemoved,
        duplicatesConsolidated: dupsFound,
        finalContacts: grouped.size,
        venues: Array.from(byVenue.keys()),
      });

      toast({ title: "Processing complete", description: `${grouped.size} contacts across ${byVenue.size} venues.` });
    } catch (err: any) {
      toast({ title: "Error processing files", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  }, [customerFile, bookingsFile, toast]);

  const downloadVenueCSV = (venue: string) => {
    const contacts = cleanedData.get(venue);
    if (!contacts) return;

    const headers = ["phone_number", "language", "voice_id", "first_message", "first_name", "child_names", "venue_name", "venue_location", "start_date", "end_date", "times", "age_range", "sheet_reference"];
    const rows = contacts.map((c) =>
      headers.map((h) => {
        const val = (c as any)[h] || (h === "language" ? "en" : "");
        return val.includes(",") ? `"${val}"` : val;
      }).join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${venue.replace(/\s+/g, "_")}_elevenlabs.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllCSVs = () => {
    for (const venue of cleanedData.keys()) {
      downloadVenueCSV(venue);
    }
  };

  const previewContacts = previewVenue ? cleanedData.get(previewVenue) || [] : [];

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Data Cleaning Tool</h1>
          <p className="text-muted-foreground mt-1">
            Upload customer &amp; bookings CSVs → get clean, deduplicated, ElevenLabs-ready files per venue.
          </p>
        </div>

        {/* Upload Section */}
        <div className="grid gap-4 md:grid-cols-2">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4" /> Bookings List CSV
              </CardTitle>
              <CardDescription>Confirmed bookings — these parents will be excluded</CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 cursor-pointer hover:border-primary/50 transition-colors">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {bookingsFile ? bookingsFile.name : "Click to upload CSV"}
                </span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload("bookings")} />
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-3">
          <Button onClick={processFiles} disabled={processing || !customerFile || !bookingsFile}>
            {processing ? "Processing..." : "Process & Clean Data"}
          </Button>
          {stats && (
            <Button variant="outline" onClick={() => { setStats(null); setCleanedData(new Map()); setCustomerFile(null); setBookingsFile(null); }}>
              <Trash2 className="h-4 w-4 mr-2" /> Reset
            </Button>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Users className="h-8 w-8 text-primary" />
                    <div>
                      <p className="text-2xl font-bold">{stats.totalCustomers}</p>
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
                    <AlertCircle className="h-8 w-8 text-warning" />
                    <div>
                      <p className="text-2xl font-bold">{stats.duplicatesConsolidated}</p>
                      <p className="text-xs text-muted-foreground">Duplicates Consolidated</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-8 w-8 text-primary" />
                    <div>
                      <p className="text-2xl font-bold">{stats.finalContacts}</p>
                      <p className="text-xs text-muted-foreground">Final Contacts ({stats.venues.length} venues)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Venue List */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Venue CSVs</CardTitle>
                <Button size="sm" onClick={downloadAllCSVs}>
                  <Download className="h-4 w-4 mr-2" /> Download All
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {stats.venues.map((venue) => (
                    <div key={venue} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div>
                        <p className="font-medium text-sm">{venue}</p>
                        <p className="text-xs text-muted-foreground">{cleanedData.get(venue)?.length || 0} contacts</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setPreviewVenue(previewVenue === venue ? null : venue)}>
                          Preview
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadVenueCSV(venue)}>
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Preview Table */}
            {previewVenue && previewContacts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Preview: {previewVenue}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Phone</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Children</TableHead>
                          <TableHead>Start</TableHead>
                          <TableHead>End</TableHead>
                          <TableHead>Times</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewContacts.slice(0, 20).map((c, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{c.phone_number}</TableCell>
                            <TableCell>{c.first_name}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{c.child_names || "—"}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{c.start_date}</TableCell>
                            <TableCell className="text-xs">{c.end_date}</TableCell>
                            <TableCell className="text-xs">{c.times}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {previewContacts.length > 20 && (
                      <p className="text-xs text-muted-foreground mt-2">Showing 20 of {previewContacts.length}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
