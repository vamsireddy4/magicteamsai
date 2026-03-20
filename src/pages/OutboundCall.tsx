import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhoneCall, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { getErrorMessage, getFunctionUnavailableMessage, isEdgeFunctionUnavailable } from "@/lib/edge-functions";
import { usePersistentState } from "@/hooks/usePersistentState";
import { ADMIN_EMAIL } from "@/lib/constants";

const OUTBOUND_REQUEST_TIMEOUT_MS = 20000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function OutboundCall() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Tables<"agents">[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<Tables<"phone_configs">[]>([]);
  const [loading, setLoading] = useState(false);
  const [availableSeconds, setAvailableSeconds] = useState<number | null>(null);
  const [form, setForm] = usePersistentState("outbound-call-form", {
    agent_id: "",
    recipient_number: "",
    phone_config_id: "",
  });

  useEffect(() => {
    if (!user) return;
    supabase.from("agents").select("*").eq("is_active", true).then(({ data }) => setAgents(data || []));
    supabase.from("phone_configs").select("*").eq("is_active", true).then(({ data }) => setPhoneConfigs(data || []));
    supabase
      .from("user_minute_balances")
      .select("available_seconds")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvailableSeconds(data?.available_seconds ?? 0));
  }, [user]);

  const selectedAgent = agents.find((a) => a.id === form.agent_id);
  const selectedPhoneConfig = phoneConfigs.find((pc) => pc.id === form.phone_config_id);
  const isAdmin = user?.email === ADMIN_EMAIL;

  const startDirectFallbackCall = async () => {
    if (!user || !selectedPhoneConfig || !selectedAgent) {
      throw new Error("Select an agent and phone number first");
    }
    if (!isAdmin && (availableSeconds ?? 0) <= 0) {
      throw new Error("No minutes left. Add minutes before placing a call.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OUTBOUND_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("/api/local/outbound-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent: selectedAgent,
          phoneConfig: selectedPhoneConfig,
          recipientNumber: form.recipient_number,
          userId: user.id,
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error("Local outbound call request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.details ? ` ${String(data.details)}` : "";
      throw new Error(`${data?.error || "Failed to place outbound call"}${detail}`);
    }

    await supabase.from("call_logs").insert({
      user_id: user.id,
      agent_id: selectedAgent.id,
      direction: "outbound",
      caller_number: selectedPhoneConfig.phone_number,
      recipient_number: form.recipient_number,
      status: "initiated",
      twilio_call_sid: data?.providerCallId || null,
      ultravox_call_id: data?.ultravoxCallId || null,
    });
  };

  const handleCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!isAdmin && (availableSeconds ?? 0) <= 0) {
      toast({ title: "Error", description: "No minutes left. Add minutes before placing a call.", variant: "destructive" });
      return;
    }
    setLoading(true);

    try {
      const { data, error } = await withTimeout(
        supabase.functions.invoke("make-outbound-call", {
          body: {
            agent_id: form.agent_id,
            recipient_number: form.recipient_number,
            phone_config_id: form.phone_config_id,
          },
        }),
        OUTBOUND_REQUEST_TIMEOUT_MS,
        "Outbound call request timed out",
      );

      if (error) {
        if (isEdgeFunctionUnavailable(error)) {
          await startDirectFallbackCall();
          toast({ title: "Call initiated!", description: "The outbound call is being placed via direct provider fallback." });
          setForm({ ...form, recipient_number: "" });
          return;
        }
        const detail = (error as any)?.context?.details || (error as any)?.details || "";
        throw new Error(`${getErrorMessage(error)}${detail ? ` ${detail}` : ""}`);
      }

      if (!data) {
        throw new Error("Outbound call request returned no data");
      }

      toast({ title: "Call initiated!", description: "The outbound call is being placed." });
      setForm({ ...form, recipient_number: "" });
    } catch (error: any) {
      const timeoutLike = String(error?.message || "").toLowerCase().includes("timed out");
      toast({
        title: "Error",
        description: timeoutLike
          ? "Outbound call request timed out. The provider or function did not respond in time."
          : isEdgeFunctionUnavailable(error)
          ? getFunctionUnavailableMessage("Outbound calling")
          : getErrorMessage(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outbound Call</h1>
          <p className="text-muted-foreground mt-1">Make an AI-powered outbound call.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5" />
              Place a Call
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCall} className="space-y-4">
              <div className="space-y-2">
                <Label>Agent</Label>
                <Select value={form.agent_id} onValueChange={(val) => setForm({ ...form, agent_id: val })}>
                  <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recipient Phone Number</Label>
                <Input
                  value={form.recipient_number}
                  onChange={(e) => setForm({ ...form, recipient_number: e.target.value })}
                  placeholder="+15551234567"
                  required
                />
                <p className="text-xs text-muted-foreground">Include country code (e.g. +1 for US)</p>
              </div>
              <div className="space-y-2">
                <Label>Phone Number (Caller ID)</Label>
                <Select value={form.phone_config_id} onValueChange={(val) => setForm({ ...form, phone_config_id: val })}>
                  <SelectTrigger><SelectValue placeholder="Select a phone number" /></SelectTrigger>
                  <SelectContent>
                    {phoneConfigs.map((pc) => (
                      <SelectItem key={pc.id} value={pc.id}>
                        {pc.phone_number} {pc.friendly_name ? `(${pc.friendly_name})` : ""} — {pc.provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !form.agent_id || !form.phone_config_id || (availableSeconds ?? 0) <= 0}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Placing Call...</>
                ) : (
                  <><PhoneCall className="h-4 w-4 mr-2" />Place Call</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
