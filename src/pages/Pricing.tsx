import DashboardLayout from "@/components/DashboardLayout";
import { ADMIN_EMAIL } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";

const plans = [
  {
    name: "Starter",
    description: "Perfect for getting started with AI calling",
    price: "$3",
    minutes: "30",
    featured: false,
  },
  {
    name: "Standard",
    description: "Most popular choice for regular users",
    price: "$6",
    minutes: "60",
    featured: true,
  },
  {
    name: "Pro",
    description: "Great value for power users",
    price: "$12",
    minutes: "120",
    featured: false,
  },
  {
    name: "Enterprise",
    description: "Best value for high-volume calling",
    price: "$30",
    minutes: "300",
    featured: false,
    enterprise: true,
  },
] as const;

const features = ["AI Voice Calling", "Never Expires", "Instant Activation"];

export default function Pricing() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [availableSeconds, setAvailableSeconds] = useState<number | null>(null);
  const [purchasingPlan, setPurchasingPlan] = useState<string | null>(null);
  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_minute_balances")
      .select("available_seconds")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvailableSeconds(data?.available_seconds ?? 0));
  }, [user]);

  const requestEnterprisePlan = async () => {
    const { error } = await supabase.auth.updateUser({
      data: {
        enterprise_interest: true,
        enterprise_requested_at: new Date().toISOString(),
      },
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Enterprise request sent", description: "The admin can now assign your custom enterprise price and minutes." });
  };

  const refreshBalance = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_minute_balances")
      .select("available_seconds")
      .eq("user_id", user.id)
      .maybeSingle();
    setAvailableSeconds(data?.available_seconds ?? 0);
  };

  const purchasePlan = async (plan: (typeof plans)[number]) => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to add minutes.", variant: "destructive" });
      return;
    }
    if (plan.enterprise) {
      await requestEnterprisePlan();
      return;
    }

    setPurchasingPlan(plan.name);
    try {
      const purchaseAmount = Number(String(plan.price).replace("$", ""));
      const isLocal = typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname);
      if (isLocal) {
        const response = await fetch("/api/local/purchase-minutes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            purchase_amount: purchaseAmount,
            rate_per_minute: 0.1,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Unable to add minutes");
        }
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("You must be signed in.");
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/purchase-minutes`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            purchase_amount: purchaseAmount,
            rate_per_minute: 0.1,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Unable to add minutes");
        }
      }

      await refreshBalance();
      toast({ title: "Minutes added", description: `${plan.minutes} minutes were added to your balance.` });
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Unable to add minutes.", variant: "destructive" });
    } finally {
      setPurchasingPlan(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-1 text-muted-foreground">
            Simple pricing. No hidden fees. Minutes never expire.
          </p>
          {isAdmin ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Current balance: <span className="font-medium text-foreground">Unlimited</span>
            </p>
          ) : availableSeconds != null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Current balance: <span className="font-medium text-foreground">{Math.floor(availableSeconds / 60)} minutes</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">AI Calling Minutes</h2>
          <div className="grid gap-6 xl:grid-cols-4 md:grid-cols-2">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={plan.featured ? "relative overflow-hidden border-primary/50 shadow-md shadow-primary/10" : "relative overflow-hidden"}
            >
              {plan.featured ? (
                <Badge className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-primary-foreground hover:bg-primary">
                  Popular
                </Badge>
              ) : null}
              <CardHeader className="space-y-4 pb-3">
                <div className="space-y-2">
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription className="min-h-[52px] text-base leading-relaxed">
                    {plan.description}
                  </CardDescription>
                </div>
                <div className="space-y-1 pt-1">
                  <div className="text-4xl font-bold tracking-tight text-foreground">{plan.price}</div>
                  <p className="text-sm text-muted-foreground">one-time payment</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-xl bg-muted/40 px-6 py-5 text-center">
                  <div className="text-3xl font-bold text-foreground">{plan.minutes}</div>
                  <div className="text-lg text-muted-foreground">minutes</div>
                </div>

                <div className="space-y-3">
                  {features.map((feature) => (
                    <div key={feature} className="flex items-center gap-3 text-sm md:text-base">
                      <Check className="h-5 w-5 text-primary" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <Button
                  className={plan.featured ? "w-full bg-primary text-primary-foreground hover:bg-primary/90" : "w-full border-primary/20 text-primary hover:bg-primary/5 hover:text-primary"}
                  variant={plan.featured ? "default" : "outline"}
                  size="lg"
                  onClick={() => void purchasePlan(plan)}
                >
                  {purchasingPlan === plan.name ? "Processing..." : plan.enterprise ? "Request Enterprise" : "Buy Now"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        </div>

        <p className="mx-auto max-w-3xl text-center text-sm md:text-base text-muted-foreground">
          All packages are one-time purchases with instant activation. Minutes are added to your account
          immediately and never expire. Payments are processed securely.
        </p>
      </div>
    </DashboardLayout>
  );
}
