import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Crown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAIL } from "@/lib/constants";

const IS_LOCAL_ADMIN = typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname);

type AdminClient = {
  user_id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  enterprise_interest: boolean;
  available_seconds: number;
  enterprise_rate_per_minute: number | null;
  last_enterprise_amount: number | null;
  last_enterprise_minutes: number | null;
};

async function callAdminFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  if (IS_LOCAL_ADMIN) {
    const response = await fetch(`/api/local/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || payload?.details || `Local route ${name} failed`);
    }

    return payload as T;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("You must be signed in.");
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body ?? {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || `Function ${name} failed`);
  }

  return payload as T;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { enterprise_rate_per_minute: string; purchase_amount: string }>>({});

  const isAdmin = user?.email === ADMIN_EMAIL;

  const loadClients = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const data = await callAdminFunction<{ clients: AdminClient[] }>("admin-list-clients");
      setClients(data.clients);
      setDrafts(
        Object.fromEntries(
          data.clients.map((client) => [
            client.user_id,
            {
              enterprise_rate_per_minute:
                client.enterprise_rate_per_minute != null ? String(client.enterprise_rate_per_minute) : "0.10",
              purchase_amount: client.last_enterprise_amount != null ? String(client.last_enterprise_amount) : "",
            },
          ]),
        ),
      );
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unable to load clients.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadClients();
  }, [isAdmin]);

  const filteredClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return clients;

    return clients.filter((client) =>
      [client.email, client.full_name ?? "", client.company_name ?? ""].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [clients, query]);

  const interestedCount = clients.filter((client) => client.enterprise_interest).length;

  const formatMinutes = (seconds: number) => Math.max(0, Math.floor(seconds / 60));

  const saveEnterpriseAccess = async (client: AdminClient) => {
    const draft = drafts[client.user_id];
    const enterpriseRatePerMinute = Number(draft?.enterprise_rate_per_minute?.trim() || "");
    const purchaseAmount = Number(draft?.purchase_amount?.trim() || "");

    if (!Number.isFinite(enterpriseRatePerMinute) || enterpriseRatePerMinute <= 0) {
      toast({ title: "Error", description: "Enter a valid enterprise rate per minute.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      toast({ title: "Error", description: "Enter a valid purchase amount.", variant: "destructive" });
      return;
    }

    setSavingUserId(client.user_id);
    try {
      const result = await callAdminFunction<{ success: boolean; credit: { creditedMinutes: number; availableSeconds: number } }>("admin-update-client-enterprise", {
        client_user_id: client.user_id,
        enterprise_rate_per_minute: enterpriseRatePerMinute,
        purchase_amount: purchaseAmount,
      });

      setClients((current) =>
        current.map((item) =>
          item.user_id === client.user_id
            ? {
                ...item,
                enterprise_rate_per_minute: enterpriseRatePerMinute,
                last_enterprise_amount: purchaseAmount,
                last_enterprise_minutes: result.credit.creditedMinutes,
                available_seconds: result.credit.availableSeconds,
                enterprise_interest: false,
              }
            : item,
        ),
      );

      toast({ title: "Minutes added successfully" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Unable to update enterprise plan.",
        variant: "destructive",
      });
    } finally {
      setSavingUserId(null);
    }
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>Admin Dashboard</CardTitle>
            <CardDescription>This page is available only for the admin account.</CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Manage platform clients and assign enterprise pricing and minutes.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Clients</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <Users className="h-6 w-6 text-primary" />
                {loading ? "..." : clients.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Enterprise Requests</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <Crown className="h-6 w-6 text-primary" />
                {loading ? "..." : interestedCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Clients</CardTitle>
                <CardDescription>Set custom enterprise price and minutes for each client.</CardDescription>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by email, name, company"
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading clients...</p>
            ) : filteredClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clients found.</p>
            ) : (
              filteredClients.map((client) => (
                <div
                  key={client.user_id}
                  className="rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          {client.full_name || client.email}
                        </h3>
                        {client.enterprise_interest ? (
                          <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                            Enterprise Request
                          </Badge>
                        ) : null}
                        {client.last_enterprise_minutes != null ? (
                          <Badge variant="secondary">
                            {client.last_enterprise_minutes} minutes
                          </Badge>
                        ) : null}
                        <Badge variant="outline">{formatMinutes(client.available_seconds)} minutes available</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{client.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {client.company_name || "No company added"}
                      </p>
                    </div>

                    <div className="grid w-full gap-3 md:grid-cols-[1fr_1fr_auto] lg:max-w-2xl">
                      <div className="space-y-2">
                        <Label>Enterprise Rate / Minute</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={drafts[client.user_id]?.enterprise_rate_per_minute ?? ""}
                          onChange={(e) =>
                            setDrafts((current) => ({
                              ...current,
                              [client.user_id]: {
                                enterprise_rate_per_minute: e.target.value,
                                purchase_amount: current[client.user_id]?.purchase_amount ?? "",
                              },
                            }))
                          }
                          placeholder="0.08"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Purchase Amount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={drafts[client.user_id]?.purchase_amount ?? ""}
                          onChange={(e) =>
                            setDrafts((current) => ({
                              ...current,
                              [client.user_id]: {
                                enterprise_rate_per_minute: current[client.user_id]?.enterprise_rate_per_minute ?? "",
                                purchase_amount: e.target.value,
                              },
                            }))
                          }
                          placeholder="99"
                        />
                        <p className="text-xs text-muted-foreground">
                          Credits{" "}
                          {(() => {
                            const rate = Number(drafts[client.user_id]?.enterprise_rate_per_minute || 0);
                            const amount = Number(drafts[client.user_id]?.purchase_amount || 0);
                            return rate > 0 && amount > 0 ? Math.floor(amount / rate) : 0;
                          })()}{" "}
                          minutes
                        </p>
                      </div>
                      <div className="flex items-end">
                        <Button
                          onClick={() => void saveEnterpriseAccess(client)}
                          disabled={savingUserId === client.user_id}
                          className="w-full md:w-auto"
                        >
                          {savingUserId === client.user_id ? "Adding..." : "Add"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
