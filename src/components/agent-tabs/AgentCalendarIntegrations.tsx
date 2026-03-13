import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Pencil, Calendar, RefreshCw } from "lucide-react";
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

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  const [viewTool, setViewTool] = useState<AppointmentTool | null>(null);
  const [editTool, setEditTool] = useState<AppointmentTool | null>(null);
  const [editName, setEditName] = useState("");
  const [editHours, setEditHours] = useState<Record<string, { enabled: boolean; start: string; end: string }>>({});
  const [editTypes, setEditTypes] = useState<{ name: string; duration: number }[]>([]);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeDuration, setNewTypeDuration] = useState(30);
  const [saving, setSaving] = useState(false);

  // Live availability state
  const [availabilityFromDate, setAvailabilityFromDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [availabilityToDate, setAvailabilityToDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [availabilityData, setAvailabilityData] = useState<any>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [viewTab, setViewTab] = useState("config");

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

  const fetchAvailability = useCallback(async (tool: AppointmentTool, date: string) => {
    if (!tool.calendar_integration_id) {
      setAvailabilityData({ error: "No calendar connected to this tool" });
      return;
    }
    setLoadingAvailability(true);
    setAvailabilityData(null);
    try {
      const { data, error } = await supabase.functions.invoke("check-calendar-availability", {
        body: {
          provider: tool.provider,
          integration_id: tool.calendar_integration_id,
          date,
        },
      });
      if (error) throw error;
      setAvailabilityData(data);
    } catch (err: any) {
      setAvailabilityData({ error: err.message || "Failed to fetch availability" });
    } finally {
      setLoadingAvailability(false);
    }
  }, []);

  const openViewTool = (tool: AppointmentTool) => {
    setViewTool(tool);
    setViewTab("config");
    setAvailabilityData(null);
    setAvailabilityFromDate(new Date().toISOString().split("T")[0]);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setAvailabilityToDate(d.toISOString().split("T")[0]);
  };

  const toggleTool = async (id: string, current: boolean) => {
    await supabase.from("appointment_tools" as any).update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const deleteTool = async (id: string) => {
    const { error } = await supabase.from("appointment_tools" as any).delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Appointment tool removed" }); fetchData(); }
  };

  const openEdit = (tool: AppointmentTool) => {
    setEditTool(tool);
    setEditName(tool.name);
    setEditHours(tool.business_hours);
    setEditTypes([...tool.appointment_types]);
    setNewTypeName("");
    setNewTypeDuration(30);
    setViewTool(null);
  };

  const handleSaveEdit = async () => {
    if (!editTool) return;
    setSaving(true);
    const { error } = await supabase.from("appointment_tools" as any).update({
      name: editName.trim(),
      business_hours: editHours,
      appointment_types: editTypes,
    } as any).eq("id", editTool.id);
    setSaving(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Appointment tool updated" }); setEditTool(null); fetchData(); }
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
                <Card key={tool.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => openViewTool(tool)}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <img src={PROVIDER_LOGOS[tool.provider]} alt={PROVIDER_NAMES[tool.provider]} className="h-8 w-8 rounded object-contain" />
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{tool.name}</span>
                        <Badge variant={tool.is_active ? "default" : "secondary"} className="text-xs">
                          {tool.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(tool)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
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

      {/* View Tool Details Dialog */}
      <Dialog open={!!viewTool} onOpenChange={(open) => { if (!open) setViewTool(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewTool && <img src={PROVIDER_LOGOS[viewTool.provider]} alt="" className="h-6 w-6 rounded object-contain" />}
              {viewTool?.name}
            </DialogTitle>
          </DialogHeader>
          {viewTool && (
            <Tabs value={viewTab} onValueChange={setViewTab} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="config" className="flex-1">Configuration</TabsTrigger>
                <TabsTrigger value="availability" className="flex-1">
                  <Calendar className="h-4 w-4 mr-1" /> Live Availability
                </TabsTrigger>
              </TabsList>

              <TabsContent value="config" className="space-y-5 mt-4">
                <div className="flex items-center gap-2">
                  <Badge variant={viewTool.is_active ? "default" : "secondary"}>
                    {viewTool.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{PROVIDER_NAMES[viewTool.provider]}</span>
                  {viewTool.calendar_integration_id && (
                    <Badge variant="outline" className="text-xs">Calendar Connected</Badge>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">Business Hours</h4>
                  <div className="space-y-1.5">
                    {DAYS.map(day => {
                      const h = viewTool.business_hours[day];
                      return (
                        <div key={day} className="flex items-center justify-between text-sm">
                          <span className={h?.enabled ? "font-medium" : "text-muted-foreground"}>{day}</span>
                          <span className={h?.enabled ? "" : "text-muted-foreground"}>
                            {h?.enabled ? `${h.start} – ${h.end}` : "Closed"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-2">Appointment Types</h4>
                  <div className="space-y-1.5">
                    {viewTool.appointment_types.map((t, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted-foreground">{t.duration} min</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button variant="outline" className="w-full" onClick={() => openEdit(viewTool)}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit Tool
                </Button>
              </TabsContent>

              <TabsContent value="availability" className="space-y-4 mt-4">
                {!viewTool.calendar_integration_id ? (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No calendar connected to this tool.</p>
                    <p className="text-xs mt-1">Connect a calendar integration first to check live availability.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs text-muted-foreground">From</Label>
                        <Input
                          type="date"
                          value={availabilityFromDate}
                          onChange={e => setAvailabilityFromDate(e.target.value)}
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs text-muted-foreground">To</Label>
                        <Input
                          type="date"
                          value={availabilityToDate}
                          onChange={e => setAvailabilityToDate(e.target.value)}
                        />
                      </div>
                    </div>

                    {loadingAvailability && (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {availabilityData && !loadingAvailability && (
                      <div className="space-y-3">
                        {availabilityData.error ? (
                          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                            {availabilityData.error}
                          </div>
                        ) : availabilityData.events ? (
                          <>
                            <h4 className="font-semibold text-sm">Events ({availabilityFromDate} to {availabilityToDate})</h4>
                            {availabilityData.events.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No events — calendar is free all day.</p>
                            ) : (
                              <div className="space-y-1.5">
                                {availabilityData.events.map((evt: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                    <span className="font-medium">{evt.summary || "Busy"}</span>
                                    <span className="text-muted-foreground text-xs">
                                      {evt.start ? new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""} 
                                      {evt.end ? ` – ${new Date(evt.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ""}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : availabilityData.slots ? (
                          <>
                            <h4 className="font-semibold text-sm">Available Slots ({availabilityFromDate} to {availabilityToDate})</h4>
                            {(Array.isArray(availabilityData.slots) && availabilityData.slots.length === 0) ? (
                              <p className="text-sm text-muted-foreground">No available slots found.</p>
                            ) : Array.isArray(availabilityData.slots) ? (
                              <div className="grid grid-cols-3 gap-2">
                                {availabilityData.slots.map((slot: any, i: number) => {
                                  const slotTime = typeof slot === "string" ? slot : (slot.time || slot.start || "");
                                  const slotDate = typeof slot === "object" && slot.date ? slot.date : "";
                                  const dt = slotTime ? new Date(slotTime) : null;
                                  return (
                                    <div key={i} className="rounded-md border px-2 py-1.5 text-xs text-center font-medium">
                                      {slotDate && <div className="text-muted-foreground">{new Date(slotDate + "T00:00:00").toLocaleDateString([], { day: '2-digit', month: 'short' })}</div>}
                                      {dt ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : JSON.stringify(slot)}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <pre className="text-xs bg-muted p-2 rounded overflow-auto">{JSON.stringify(availabilityData.slots, null, 2)}</pre>
                            )}
                          </>
                        ) : (
                          <div className="text-sm">
                            <Badge variant="outline" className="mb-2">Connection OK</Badge>
                            {availabilityData.calendar && <p className="text-muted-foreground">Calendar: {availabilityData.calendar}</p>}
                            {availabilityData.user && <p className="text-muted-foreground">User: {availabilityData.user}</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {!availabilityData && !loadingAvailability && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Loading availability...</p>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Tool Dialog */}
      <Dialog open={!!editTool} onOpenChange={(open) => { if (!open) setEditTool(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Appointment Tool</DialogTitle>
          </DialogHeader>
          {editTool && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Tool Name</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>

              <div className="rounded-lg border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm">Business Hours</h3>
                <div className="space-y-3">
                  {DAYS.map(day => {
                    const hours = editHours[day] || { enabled: false, start: "09:00", end: "17:00" };
                    return (
                      <div key={day} className="flex items-center gap-3">
                        <div className="flex items-center gap-2 w-32">
                          <Checkbox
                            checked={hours.enabled}
                            onCheckedChange={(checked) =>
                              setEditHours({ ...editHours, [day]: { ...hours, enabled: !!checked } })
                            }
                          />
                          <span className="text-sm font-medium">{day}</span>
                        </div>
                        {hours.enabled ? (
                          <div className="flex items-center gap-2">
                            <Input type="time" value={hours.start}
                              onChange={e => setEditHours({ ...editHours, [day]: { ...hours, start: e.target.value } })}
                              className="w-32" />
                            <span className="text-muted-foreground text-sm">to</span>
                            <Input type="time" value={hours.end}
                              onChange={e => setEditHours({ ...editHours, [day]: { ...hours, end: e.target.value } })}
                              className="w-32" />
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Closed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border bg-card p-5 space-y-4">
                <h3 className="font-semibold text-sm">Appointment Types</h3>
                <div className="space-y-2">
                  {editTypes.map((type, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div>
                        <span className="text-sm font-medium">{type.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{type.duration} min</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setEditTypes(editTypes.filter((_, idx) => idx !== i))} className="text-destructive h-7 px-2">
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input placeholder="e.g. Follow-up" value={newTypeName} onChange={e => setNewTypeName(e.target.value)} />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Duration (min)</Label>
                    <Input type="number" min={5} step={5} value={newTypeDuration} onChange={e => setNewTypeDuration(parseInt(e.target.value) || 30)} />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => {
                    if (!newTypeName.trim()) return;
                    setEditTypes([...editTypes, { name: newTypeName.trim(), duration: newTypeDuration }]);
                    setNewTypeName(""); setNewTypeDuration(30);
                  }} disabled={!newTypeName.trim()}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setEditTool(null)}>Cancel</Button>
                <Button onClick={handleSaveEdit} disabled={saving || !editName.trim() || editTypes.length === 0}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
