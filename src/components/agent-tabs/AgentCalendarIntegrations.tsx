import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, CalendarDays } from "lucide-react";
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

interface AppointmentTool {
  id: string;
  name: string;
  provider: string;
  calendar_integration_id: string | null;
  business_hours: Record<string, { enabled: boolean; start: string; end: string }>;
  appointment_types: { name: string; duration: number }[];
  is_active: boolean;
  created_at: string;
}

const PROVIDER_LOGOS: Record<string, string> = {
  google_calendar: googleCalendarLogo,
  cal_com: calcomLogo,
  gohighlevel: gohighlevelLogo,
};

const PROVIDER_NAMES: Record<string, string> = {
  google_calendar: "Google Calendar",
  cal_com: "Cal.com",
  gohighlevel: "GoHighLevel",
};

interface Props {
  agentId: string;
  userId: string;
}

export default function AgentCalendarIntegrations({ agentId, userId }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<CalendarIntegration[]>([]);
  const [tools, setTools] = useState<AppointmentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchData = async () => {
    const [intRes, toolsRes] = await Promise.all([
      supabase.from("calendar_integrations").select("*").eq("user_id", userId).order("created_at"),
      supabase.from("appointment_tools" as any).select("*").eq("agent_id", agentId).order("created_at"),
    ]);
    setIntegrations((intRes.data as CalendarIntegration[]) || []);
    setTools((toolsRes.data as any as AppointmentTool[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`appt-tools-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_tools" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_integrations" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const toggleTool = async (id: string, current: boolean) => {
    await supabase.from("appointment_tools" as any).update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const deleteTool = async (id: string) => {
    const { error } = await supabase.from("appointment_tools" as any).delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Appointment tool removed" }); fetchData(); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Connect calendars so this agent can check availability and book appointments during calls.</p>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {tools.length > 0 && (
            <div className="space-y-3">
              {tools.map(tool => (
                <Card key={tool.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <img src={PROVIDER_LOGOS[tool.provider]} alt={PROVIDER_NAMES[tool.provider]} className="h-8 w-8 rounded object-contain" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{tool.name}</span>
                          <Badge variant={tool.is_active ? "default" : "secondary"} className="text-xs">
                            {tool.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {PROVIDER_NAMES[tool.provider]} · {tool.appointment_types.length} type{tool.appointment_types.length !== 1 ? "s" : ""} · {tool.appointment_types.map(t => `${t.name} (${t.duration}m)`).join(", ")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={tool.is_active} onCheckedChange={() => toggleTool(tool.id, tool.is_active)} />
                      <Button variant="ghost" size="icon" onClick={() => deleteTool(tool.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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
