import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Plus, Trash2, CheckCircle2, Loader2, X,
  ArrowRight, ArrowLeft, Clock, AlertCircle,
} from "lucide-react";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

interface CalendarIntegration {
  id: string;
  user_id: string;
  provider: string;
  display_name: string;
  api_key: string | null;
  calendar_id: string | null;
  is_active: boolean;
  config: Record<string, any>;
  created_at: string;
}

const PROVIDERS = [
  { id: "google_calendar", name: "Google Calendar", logo: googleCalendarLogo },
  { id: "cal_com", name: "Cal.com", logo: calcomLogo },
  { id: "gohighlevel", name: "GoHighLevel Calendar", logo: gohighlevelLogo },
];

const PROVIDER_FIELDS: Record<string, { apiLabel: string; apiPlaceholder: string; apiHelp: string; calLabel: string; calPlaceholder: string; calHelp: string }> = {
  google_calendar: {
    apiLabel: "Google API Key", apiPlaceholder: "AIza...", apiHelp: "Create an API key with Calendar API enabled.",
    calLabel: "Calendar ID", calPlaceholder: "primary or your@email.com", calHelp: "Use 'primary' for your main calendar.",
  },
  cal_com: {
    apiLabel: "Cal.com API Key", apiPlaceholder: "cal_live_...", apiHelp: "Settings → Developer → API Keys.",
    calLabel: "Event Type ID", calPlaceholder: "123456", calHelp: "Event type ID from your booking page URL.",
  },
  gohighlevel: {
    apiLabel: "GHL API Key", apiPlaceholder: "ghl-...", apiHelp: "Settings → Business Profile → API Key.",
    calLabel: "Calendar ID", calPlaceholder: "calendar-uuid", calHelp: "Calendar ID from GHL settings.",
  },
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DEFAULT_HOURS: Record<string, { enabled: boolean; start: string; end: string }> = {};
DAYS.forEach((d, i) => {
  DEFAULT_HOURS[d] = { enabled: i < 5, start: "09:00", end: "17:00" };
});

interface AppointmentType {
  name: string;
  duration: number;
  description: string;
}

const DEFAULT_TYPES: AppointmentType[] = [
  { name: "Consultation", duration: 30, description: "Initial consultation call" },
];

interface Props {
  agentId: string;
  userId: string;
}

export default function AgentAppointmentTools({ agentId, userId }: Props) {
  const { toast } = useToast();
  const [tools, setTools] = useState<CalendarIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // Wizard state
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState("cal_com");
  const [toolName, setToolName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [businessHours, setBusinessHours] = useState(DEFAULT_HOURS);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>(DEFAULT_TYPES);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    const { data } = await supabase
      .from("calendar_integrations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    setTools((data as CalendarIntegration[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`appt-tools-${agentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_integrations" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId]);

  const resetWizard = () => {
    setCreating(false);
    setStep(1);
    setProvider("cal_com");
    setToolName("");
    setApiKey("");
    setCalendarId("");
    setBusinessHours(DEFAULT_HOURS);
    setAppointmentTypes(DEFAULT_TYPES);
  };

  const handleSave = async () => {
    if (!apiKey) {
      toast({ title: "Missing API key", variant: "destructive" });
      return;
    }
    setSaving(true);
    const providerInfo = PROVIDERS.find(p => p.id === provider);
    const { error } = await supabase.from("calendar_integrations").insert({
      user_id: userId,
      provider,
      display_name: toolName || providerInfo?.name || provider,
      api_key: apiKey,
      calendar_id: calendarId || null,
      config: { business_hours: businessHours, appointment_types: appointmentTypes },
    } as any);
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Appointment tool created" });
      resetWizard();
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("calendar_integrations").delete().eq("id", id);
    if (selectedTool === id) setSelectedTool(null);
    toast({ title: "Tool deleted" });
    fetchData();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("calendar_integrations").update({ is_active: !current } as any).eq("id", id);
    fetchData();
  };

  const handleTest = async (integration: CalendarIntegration) => {
    setTesting(integration.id);
    try {
      const { error } = await supabase.functions.invoke("check-calendar-availability", {
        body: { provider: integration.provider, integration_id: integration.id, test: true },
      });
      if (error) throw error;
      toast({ title: "Connection successful", description: `${integration.display_name} is working.` });
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message || "Could not reach the calendar API.", variant: "destructive" });
    }
    setTesting(null);
  };

  const updateBusinessDay = (day: string, field: string, value: any) => {
    setBusinessHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const addAppointmentType = () => {
    setAppointmentTypes(prev => [...prev, { name: "", duration: 30, description: "" }]);
  };

  const removeAppointmentType = (index: number) => {
    setAppointmentTypes(prev => prev.filter((_, i) => i !== index));
  };

  const updateAppointmentType = (index: number, field: keyof AppointmentType, value: any) => {
    setAppointmentTypes(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const providerFields = PROVIDER_FIELDS[provider];
  const selectedToolData = tools.find(t => t.id === selectedTool);

  const STEPS = [
    { num: 1, label: "Basic Details", sub: "Setup calendar and tool info" },
    { num: 2, label: "Business Hours", sub: "Set your availability" },
    { num: 3, label: "Appointment Types", sub: "Define booking options" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-4 min-h-[400px]">
        {/* Left sidebar */}
        <div className="w-64 shrink-0 space-y-3">
          <Button className="w-full" onClick={() => { resetWizard(); setCreating(true); setSelectedTool(null); }}>
            <Plus className="h-4 w-4 mr-2" /> New Appointment Tool
          </Button>
          <p className="text-xs font-medium text-muted-foreground px-1">Your Tools</p>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : tools.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-xs text-muted-foreground">No appointment tools found. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {tools.map(tool => {
                const prov = PROVIDERS.find(p => p.id === tool.provider);
                return (
                  <button
                    key={tool.id}
                    onClick={() => { setSelectedTool(tool.id); setCreating(false); }}
                    className={`w-full text-left rounded-md border p-2.5 text-sm transition-colors ${
                      selectedTool === tool.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <img src={prov?.logo} alt="" className="h-5 w-5 rounded object-contain" />
                      <span className="font-medium truncate">{tool.display_name}</span>
                    </div>
                    <div className="mt-1">
                      <Badge variant={tool.is_active ? "default" : "secondary"} className="text-[10px] h-4">
                        {tool.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0">
          {creating ? (
            <div className="rounded-lg border bg-card p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Create Appointment Tool</h3>
                <Button variant="ghost" size="icon" onClick={resetWizard}><X className="h-4 w-4" /></Button>
              </div>

              {/* Stepper */}
              <div className="flex items-center gap-2">
                {STEPS.map((s, i) => (
                  <div key={s.num} className="flex items-center gap-2 flex-1">
                    <div className={`flex items-center gap-2 ${step === s.num ? "text-foreground" : "text-muted-foreground"}`}>
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                        step === s.num ? "border-primary bg-primary text-primary-foreground" :
                        step > s.num ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30"
                      }`}>{s.num}</div>
                      <div className="hidden sm:block">
                        <p className="text-xs font-medium leading-tight">{s.label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{s.sub}</p>
                      </div>
                    </div>
                    {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
                  </div>
                ))}
              </div>

              <Separator />

              {/* Step 1: Basic Details */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h4 className="font-semibold">Basic Details</h4>
                    <p className="text-sm text-muted-foreground">Provide basic information about your appointment tool</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Tool Name</Label>
                    <Input placeholder="e.g. My Booking Calendar" value={toolName} onChange={e => setToolName(e.target.value)} />
                  </div>

                  <div className="space-y-3">
                    <Label>Calendar Source</Label>
                    <RadioGroup value={provider} onValueChange={setProvider} className="flex flex-wrap gap-4">
                      {PROVIDERS.map(p => (
                        <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                          <RadioGroupItem value={p.id} />
                          <img src={p.logo} alt="" className="h-5 w-5 rounded object-contain" />
                          <span className="text-sm">{p.name}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <img src={PROVIDERS.find(p => p.id === provider)?.logo} alt="" className="h-5 w-5 rounded object-contain" />
                      <span className="font-medium text-sm">{PROVIDERS.find(p => p.id === provider)?.name} Account</span>
                    </div>

                    <div className="space-y-2">
                      <Label>{providerFields?.apiLabel}</Label>
                      <Input type="password" placeholder={providerFields?.apiPlaceholder} value={apiKey} onChange={e => setApiKey(e.target.value)} />
                      <p className="text-xs text-muted-foreground">{providerFields?.apiHelp}</p>
                    </div>

                    <div className="space-y-2">
                      <Label>{providerFields?.calLabel}</Label>
                      <Input placeholder={providerFields?.calPlaceholder} value={calendarId} onChange={e => setCalendarId(e.target.value)} />
                      <p className="text-xs text-muted-foreground">{providerFields?.calHelp}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Business Hours */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h4 className="font-semibold">Business Hours</h4>
                    <p className="text-sm text-muted-foreground">Set your available hours for appointments</p>
                  </div>
                  <div className="space-y-2">
                    {DAYS.map(day => (
                      <div key={day} className="flex items-center gap-3 rounded-md border p-2.5 bg-background">
                        <Checkbox
                          checked={businessHours[day]?.enabled}
                          onCheckedChange={v => updateBusinessDay(day, "enabled", !!v)}
                          id={`day-${day}`}
                        />
                        <label htmlFor={`day-${day}`} className="text-sm font-medium w-24">{day}</label>
                        {businessHours[day]?.enabled ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="time"
                              className="w-28 h-8 text-xs"
                              value={businessHours[day].start}
                              onChange={e => updateBusinessDay(day, "start", e.target.value)}
                            />
                            <span className="text-xs text-muted-foreground">to</span>
                            <Input
                              type="time"
                              className="w-28 h-8 text-xs"
                              value={businessHours[day].end}
                              onChange={e => updateBusinessDay(day, "end", e.target.value)}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Closed</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Appointment Types */}
              {step === 3 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold">Appointment Types</h4>
                      <p className="text-sm text-muted-foreground">Define the types of appointments clients can book</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={addAppointmentType}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Type
                    </Button>
                  </div>
                  {appointmentTypes.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No appointment types. Add at least one.</p>
                  )}
                  {appointmentTypes.map((apt, i) => (
                    <div key={i} className="rounded-md border p-3 space-y-3 bg-background">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Type {i + 1}</p>
                        <Button variant="ghost" size="sm" className="text-destructive h-auto p-0 text-xs" onClick={() => removeAppointmentType(i)}>Remove</Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Name</Label>
                          <Input value={apt.name} placeholder="e.g. Consultation" onChange={e => updateAppointmentType(i, "name", e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Duration (minutes)</Label>
                          <Input type="number" value={apt.duration} onChange={e => updateAppointmentType(i, "duration", parseInt(e.target.value) || 15)} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input value={apt.description} placeholder="Brief description" onChange={e => updateAppointmentType(i, "description", e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  {step > 1 && (
                    <Button variant="outline" onClick={() => setStep(step - 1)}>
                      <ArrowLeft className="h-4 w-4 mr-1" /> Back
                    </Button>
                  )}
                  {step === 1 && (
                    <Button variant="outline" onClick={resetWizard}>Cancel</Button>
                  )}
                </div>
                {step < 3 ? (
                  <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !apiKey}>
                    Next <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Creating..." : "Create Tool"}
                  </Button>
                )}
              </div>
            </div>
          ) : selectedToolData ? (
            /* Tool detail view */
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={PROVIDERS.find(p => p.id === selectedToolData.provider)?.logo} alt="" className="h-8 w-8 rounded object-contain" />
                  <div>
                    <h3 className="font-semibold">{selectedToolData.display_name}</h3>
                    <p className="text-xs text-muted-foreground">{PROVIDERS.find(p => p.id === selectedToolData.provider)?.name}</p>
                  </div>
                </div>
                <Badge variant={selectedToolData.is_active ? "default" : "secondary"}>
                  {selectedToolData.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>

              <Separator />

              {selectedToolData.calendar_id && (
                <div>
                  <p className="text-xs text-muted-foreground">Calendar ID</p>
                  <p className="text-sm font-mono">{selectedToolData.calendar_id}</p>
                </div>
              )}

              {selectedToolData.config?.business_hours && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Business Hours</p>
                  <div className="space-y-1">
                    {DAYS.map(day => {
                      const h = (selectedToolData.config as any)?.business_hours?.[day];
                      if (!h?.enabled) return <p key={day} className="text-xs text-muted-foreground">{day}: Closed</p>;
                      return <p key={day} className="text-xs">{day}: {h.start} – {h.end}</p>;
                    })}
                  </div>
                </div>
              )}

              {selectedToolData.config?.appointment_types && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Appointment Types</p>
                  <div className="space-y-1">
                    {((selectedToolData.config as any)?.appointment_types || []).map((t: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs">{t.name} ({t.duration} min)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleTest(selectedToolData)} disabled={testing === selectedToolData.id}>
                  {testing === selectedToolData.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                  Test Connection
                </Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Switch checked={selectedToolData.is_active} onCheckedChange={() => toggleActive(selectedToolData.id, selectedToolData.is_active)} />
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(selectedToolData.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Empty state */
            <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Select a tool or create a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
