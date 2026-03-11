import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneIncoming, PhoneOutgoing, History, RefreshCw, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

interface CallLog {
  id: string;
  direction: string;
  caller_number: string | null;
  recipient_number: string | null;
  status: string;
  duration: number | null;
  started_at: string;
  ended_at: string | null;
  transcript: Json | null;
  ultravox_call_id: string | null;
  twilio_call_sid: string | null;
  agents: { name: string } | null;
}

export default function CallLogs() {
  const { user } = useAuth();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchCalls = () => {
    if (!user) return;
    supabase
      .from("call_logs")
      .select("*, agents(name)")
      .order("started_at", { ascending: false })
      .then(({ data }) => {
        setCalls((data as any) || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchCalls();
  }, [user]);

  const syncCallData = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-call-data");
      if (error) throw error;
      toast.success(`Synced ${data.updated} call(s)`);
      fetchCalls();
    } catch (e: any) {
      toast.error("Failed to sync: " + (e.message || "Unknown error"));
    } finally {
      setSyncing(false);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "default";
      case "in-progress": return "secondary";
      case "failed": return "destructive";
      default: return "outline" as const;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getCallId = (call: CallLog) => {
    return call.ultravox_call_id || call.twilio_call_sid || call.id;
  };

  const shortId = (id: string) => {
    if (id.length > 12) return id.slice(0, 6) + "…" + id.slice(-4);
    return id;
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full animate-fade-in">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Call History</h1>
            <p className="text-muted-foreground mt-1">View all inbound and outbound calls with transcripts.</p>
          </div>
          <Button variant="outline" size="sm" onClick={syncCallData} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Call Data"}
          </Button>
        </div>

        <Card className="flex-1 min-h-0 flex flex-col">
          {loading ? (
            <CardContent className="p-6">
              <div className="animate-pulse space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 bg-muted rounded" />
                ))}
              </div>
            </CardContent>
          ) : calls.length === 0 ? (
            <CardContent className="flex flex-col items-center justify-center py-16">
              <History className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No calls yet</h3>
              <p className="text-sm text-muted-foreground">Calls will appear here once your agents start receiving them.</p>
            </CardContent>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Call ID</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Transcript</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((call) => (
                    <TableRow
                      key={call.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedCall(call)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {call.direction === "inbound" ? (
                            <PhoneIncoming className="h-4 w-4 text-accent-foreground" />
                          ) : (
                            <PhoneOutgoing className="h-4 w-4 text-primary" />
                          )}
                          <span className="capitalize text-sm">{call.direction}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground" title={getCallId(call)}>
                          {shortId(getCallId(call))}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {call.direction === "inbound" ? call.caller_number : call.recipient_number}
                      </TableCell>
                      <TableCell className="text-sm">{call.agents?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusColor(call.status) as any}>{call.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{formatDuration(call.duration)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div>{formatDate(call.started_at)}</div>
                        <div className="text-xs">{formatTime(call.started_at)}</div>
                      </TableCell>
                      <TableCell>
                        {call.transcript ? (
                          <Badge variant="outline" className="text-xs">Available</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Call details dialog */}
        <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Call Details</DialogTitle>
            </DialogHeader>
            {selectedCall && (
              <div className="space-y-5">
                {/* Call metadata grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Call ID</p>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{shortId(getCallId(selectedCall))}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(getCallId(selectedCall)); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {copiedId === getCallId(selectedCall) ? (
                          <Check className="h-3 w-3 text-primary" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Direction</p>
                    <p className="capitalize font-medium">{selectedCall.direction}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                    <Badge variant={statusColor(selectedCall.status) as any}>{selectedCall.status}</Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Duration</p>
                    <p className="font-mono font-medium">{formatDuration(selectedCall.duration)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Agent</p>
                    <p className="font-medium">{selectedCall.agents?.name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Phone Number</p>
                    <p className="font-mono text-xs">
                      {selectedCall.direction === "inbound" ? selectedCall.caller_number : selectedCall.recipient_number}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Started At</p>
                    <p className="text-xs">{new Date(selectedCall.started_at).toLocaleString()}</p>
                  </div>
                  {selectedCall.ended_at && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Ended At</p>
                      <p className="text-xs">{new Date(selectedCall.ended_at).toLocaleString()}</p>
                    </div>
                  )}
                  {selectedCall.twilio_call_sid && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Twilio SID</p>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{shortId(selectedCall.twilio_call_sid)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyToClipboard(selectedCall.twilio_call_sid!); }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {copiedId === selectedCall.twilio_call_sid ? (
                            <Check className="h-3 w-3 text-primary" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Transcript */}
                {selectedCall.transcript ? (
                  <div>
                    <p className="text-sm font-medium mb-2">Transcript</p>
                    <div className="rounded-lg bg-muted p-4 text-sm space-y-3 max-h-80 overflow-auto">
                      {Array.isArray(selectedCall.transcript)
                        ? (selectedCall.transcript as any[]).map((msg, i) => (
                            <div key={i} className="flex gap-2">
                              <Badge
                                variant={msg.role === "agent" ? "default" : "secondary"}
                                className="text-xs shrink-0 h-5 mt-0.5"
                              >
                                {msg.role === "agent" ? "Agent" : "Caller"}
                              </Badge>
                              <p className="text-sm leading-relaxed">{msg.text}</p>
                            </div>
                          ))
                        : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(selectedCall.transcript, null, 2)}</pre>
                      }
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      No transcript available. Click "Sync Call Data" to fetch transcripts.
                    </p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
