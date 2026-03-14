import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneIncoming, PhoneOutgoing, History, Copy, Check, FileText, Clock, User } from "lucide-react";
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
  summary: string | null;
  ultravox_call_id: string | null;
  twilio_call_sid: string | null;
  agents: { name: string } | null;
}

export default function CallLogs() {
  const { user } = useAuth();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
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

    const channel = supabase
      .channel('call-logs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_logs' }, () => fetchCalls())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

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

  const handleSelectCall = (call: CallLog) => {
    setSelectedCall(call);
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full animate-fade-in">
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Call History</h1>
            <p className="text-muted-foreground mt-1">View all inbound and outbound calls with transcripts.</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : calls.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <History className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No calls yet</h3>
              <p className="text-sm text-muted-foreground">Calls will appear here once your agents start receiving them.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {calls.map((call) => (
              <Card
                key={call.id}
                className="cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => handleSelectCall(call)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  {/* Direction icon */}
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                    call.direction === "inbound" ? "bg-accent" : "bg-primary/10"
                  }`}>
                    {call.direction === "inbound" ? (
                      <PhoneIncoming className="h-4 w-4 text-accent-foreground" />
                    ) : (
                      <PhoneOutgoing className="h-4 w-4 text-primary" />
                    )}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm truncate font-mono">
                        {call.direction === "inbound" ? call.caller_number : call.recipient_number}
                      </p>
                      <Badge variant={statusColor(call.status) as any} className="text-[10px] shrink-0">
                        {call.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="capitalize">{call.direction}</span>
                      {call.agents?.name && (
                        <>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {call.agents.name}
                          </span>
                        </>
                      )}
                      {call.transcript && (
                        <>
                          <span>·</span>
                          <Badge variant="outline" className="text-[10px] h-4">Transcript</Badge>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Duration & time */}
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-medium">{formatDuration(call.duration)}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                      <Clock className="h-3 w-3" />
                      <span>{formatDate(call.started_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

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
                      No transcript available.
                    </p>
                  </div>
                )}

                {/* Call Summary */}
                {selectedCall.summary && (
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1.5 mb-2">
                      <FileText className="h-4 w-4 text-primary" /> Call Summary
                    </p>
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-sm whitespace-pre-wrap">
                      {selectedCall.summary}
                    </div>
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
