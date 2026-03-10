import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneIncoming, PhoneOutgoing, History, RefreshCw } from "lucide-react";
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
  agents: { name: string } | null;
}

export default function CallLogs() {
  const { user } = useAuth();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("call_logs")
      .select("*, agents(name)")
      .order("started_at", { ascending: false })
      .then(({ data }) => {
        setCalls((data as any) || []);
        setLoading(false);
      });
  }, [user]);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "default";
      case "in-progress": return "secondary";
      case "failed": return "destructive";
      default: return "outline" as const;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call History</h1>
          <p className="text-muted-foreground mt-1">View all inbound and outbound calls.</p>
        </div>

        <Card>
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
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.map((call) => (
                    <TableRow
                      key={call.id}
                      className="cursor-pointer"
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
                      <TableCell className="font-mono text-sm">
                        {call.direction === "inbound" ? call.caller_number : call.recipient_number}
                      </TableCell>
                      <TableCell className="text-sm">{call.agents?.name || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusColor(call.status) as any}>{call.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{formatDuration(call.duration)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(call.started_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        {/* Transcript dialog */}
        <Dialog open={!!selectedCall} onOpenChange={() => setSelectedCall(null)}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Call Details</DialogTitle>
            </DialogHeader>
            {selectedCall && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Direction</p>
                    <p className="capitalize font-medium">{selectedCall.direction}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium">{selectedCall.status}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Duration</p>
                    <p className="font-medium">{formatDuration(selectedCall.duration)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Agent</p>
                    <p className="font-medium">{selectedCall.agents?.name || "—"}</p>
                  </div>
                </div>
                {selectedCall.transcript && (
                  <div>
                    <p className="text-sm font-medium mb-2">Transcript</p>
                    <div className="rounded-lg bg-muted p-4 text-sm space-y-2 max-h-60 overflow-auto">
                      {Array.isArray(selectedCall.transcript)
                        ? (selectedCall.transcript as any[]).map((msg, i) => (
                            <div key={i}>
                              <span className="font-medium">{msg.role}: </span>
                              <span>{msg.text}</span>
                            </div>
                          ))
                        : <pre className="whitespace-pre-wrap">{JSON.stringify(selectedCall.transcript, null, 2)}</pre>
                      }
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
