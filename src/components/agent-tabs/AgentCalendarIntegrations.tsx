import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CreateAppointmentToolDialog from "./CreateAppointmentToolDialog";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

interface CalendarIntegration {
  id: string; user_id: string; provider: string; display_name: string;
  api_key: string | null; calendar_id: string | null; is_active: boolean;
  config: Record<string, any>; created_at: string;
}

const PROVIDER_LOGOS: Record<string, string> = {
  google_calendar: googleCalendarLogo,
  cal_com: calcomLogo,
  gohighlevel: gohighlevelLogo,
};

interface Props {
  agentId: string;
  userId: string;
}

export default function AgentCalendarIntegrations({ agentId, userId }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase.from("calendar_integrations").select("*").eq("user_id", userId).order("created_at");
    setIntegrations((data as CalendarIntegration[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`cal-agent-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_integrations" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Connect calendars so this agent can check availability and book appointments during calls.</p>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {integrations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {integrations.map(integration => (
                <div key={integration.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <img src={PROVIDER_LOGOS[integration.provider]} alt={integration.display_name} className="h-5 w-5 rounded object-contain" />
                  <span className="text-sm font-medium">{integration.display_name}</span>
                  <Badge variant={integration.is_active ? "default" : "secondary"} className="text-xs">
                    {integration.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          {integrations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No calendars connected. Add an appointment tool or go to Calendar Integrations.</p>
          )}

          <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Appointment Tool
          </Button>
        </>
      )}

      <CreateAppointmentToolDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        integrations={integrations}
        onNavigateToCalendarIntegrations={() => { setWizardOpen(false); navigate("/calendar-integrations"); }}
        agentId={agentId}
        userId={userId}
        onToolCreated={() => { toast({ title: "Appointment tool created" }); fetchData(); }}
      />
    </div>
  );
}
