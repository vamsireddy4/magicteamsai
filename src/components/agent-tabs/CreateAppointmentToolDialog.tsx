import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CalendarDays, Plus } from "lucide-react";
import googleCalendarLogo from "@/assets/google-calendar-logo.png";
import calcomLogo from "@/assets/calcom-logo.png";
import gohighlevelLogo from "@/assets/gohighlevel-logo.png";

const STEPS = [
  { label: "Basic Details", description: "Setup calendar and tool info" },
  { label: "Business Hours", description: "Set your availability" },
  { label: "Appointment Types", description: "Define booking options" },
];

const CALENDAR_SOURCES = [
  { id: "google_calendar", name: "Google Calendar", logo: googleCalendarLogo },
  { id: "cal_com", name: "Cal.com", logo: calcomLogo },
  { id: "gohighlevel", name: "GoHighLevel Calendar", logo: gohighlevelLogo },
];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface ConnectedIntegration {
  id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  calendar_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrations: ConnectedIntegration[];
  onNavigateToCalendarIntegrations: () => void;
  agentId: string;
  userId: string;
  onToolCreated: () => void;
}

export default function CreateAppointmentToolDialog({
  open,
  onOpenChange,
  integrations,
  onNavigateToCalendarIntegrations,
  agentId,
  userId,
  onToolCreated,
}: Props) {
  const [step, setStep] = useState(0);
  const [selectedSource, setSelectedSource] = useState("cal_com");
  const [toolName, setToolName] = useState("");
  const [businessHours, setBusinessHours] = useState<Record<string, { enabled: boolean; start: string; end: string }>>(
    Object.fromEntries(DAYS.map(d => [d, { enabled: d !== "Saturday" && d !== "Sunday", start: "09:00", end: "17:00" }]))
  );
  const [appointmentTypes, setAppointmentTypes] = useState([
    { name: "Consultation", duration: 30 },
  ]);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeDuration, setNewTypeDuration] = useState(30);

  const connectedForSource = integrations.find(i => i.provider === selectedSource && i.is_active);
  const sourceConfig = CALENDAR_SOURCES.find(s => s.id === selectedSource);

  const resetForm = () => {
    setStep(0);
    setSelectedSource("cal_com");
    setToolName("");
    setBusinessHours(Object.fromEntries(DAYS.map(d => [d, { enabled: d !== "Saturday" && d !== "Sunday", start: "09:00", end: "17:00" }])));
    setAppointmentTypes([{ name: "Consultation", duration: 30 }]);
  };

  const handleClose = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const canProceedStep0 = !!connectedForSource && toolName.trim().length > 0;
  const canProceedStep1 = Object.values(businessHours).some(h => h.enabled);
  const canFinish = appointmentTypes.length > 0;

  const handleAddType = () => {
    if (!newTypeName.trim()) return;
    setAppointmentTypes([...appointmentTypes, { name: newTypeName.trim(), duration: newTypeDuration }]);
    setNewTypeName("");
    setNewTypeDuration(30);
  };

  const handleRemoveType = (index: number) => {
    setAppointmentTypes(appointmentTypes.filter((_, i) => i !== index));
  };

  const handleFinish = () => {
    // For now, just close and notify — the tool config is stored in the agent's context
    onToolCreated();
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Appointment Tool</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold shrink-0 ${
                i <= step ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
              }`}>
                {i + 1}
              </div>
              <div className="hidden sm:block min-w-0">
                <p className={`text-sm font-medium truncate ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</p>
                <p className="text-xs text-muted-foreground truncate">{s.description}</p>
              </div>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-foreground" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        {/* Step 0: Basic Details */}
        {step === 0 && (
          <div className="space-y-6">
            <div className="rounded-lg border bg-card p-5 space-y-5">
              <div>
                <h3 className="font-semibold text-base">Basic Details</h3>
                <p className="text-sm text-muted-foreground">Provide basic information about your appointment tool</p>
              </div>

              <div className="space-y-2">
                <Label>Tool Name</Label>
                <Input
                  placeholder="e.g. Book a Consultation"
                  value={toolName}
                  onChange={e => setToolName(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <Label className="font-semibold">Calendar Source</Label>
                <RadioGroup value={selectedSource} onValueChange={setSelectedSource} className="flex flex-wrap gap-4">
                  {CALENDAR_SOURCES.map(source => (
                    <div key={source.id} className="flex items-center gap-2">
                      <RadioGroupItem value={source.id} id={source.id} />
                      <Label htmlFor={source.id} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <img src={source.logo} alt={source.name} className="h-4 w-4 rounded object-contain" />
                        {source.name}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{sourceConfig?.name} Account</span>
                </div>

                {connectedForSource ? (
                  <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3">
                    <img src={sourceConfig?.logo} alt="" className="h-6 w-6 rounded object-contain" />
                    <div>
                      <p className="text-sm font-medium">{connectedForSource.display_name}</p>
                      <p className="text-xs text-muted-foreground">Calendar: {connectedForSource.calendar_id || "Default"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-muted/30 p-6 flex flex-col items-center gap-3 text-center">
                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-semibold text-sm">No {sourceConfig?.name} Account Found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        You need to connect your {sourceConfig?.name} account to create appointment tools.
                      </p>
                    </div>
                    <Button variant="default" size="sm" onClick={onNavigateToCalendarIntegrations}>
                      <Plus className="h-4 w-4 mr-1" /> Connect {sourceConfig?.name} Account
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Business Hours */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-base">Business Hours</h3>
                <p className="text-sm text-muted-foreground">Set the hours when appointments can be booked</p>
              </div>

              <div className="space-y-3">
                {DAYS.map(day => {
                  const hours = businessHours[day];
                  return (
                    <div key={day} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 w-32">
                        <Checkbox
                          checked={hours.enabled}
                          onCheckedChange={(checked) =>
                            setBusinessHours({ ...businessHours, [day]: { ...hours, enabled: !!checked } })
                          }
                        />
                        <span className="text-sm font-medium">{day}</span>
                      </div>
                      {hours.enabled ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={hours.start}
                            onChange={e => setBusinessHours({ ...businessHours, [day]: { ...hours, start: e.target.value } })}
                            className="w-32"
                          />
                          <span className="text-muted-foreground text-sm">to</span>
                          <Input
                            type="time"
                            value={hours.end}
                            onChange={e => setBusinessHours({ ...businessHours, [day]: { ...hours, end: e.target.value } })}
                            className="w-32"
                          />
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Appointment Types */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-base">Appointment Types</h3>
                <p className="text-sm text-muted-foreground">Define the types of appointments that can be booked</p>
              </div>

              <div className="space-y-2">
                {appointmentTypes.map((type, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{type.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{type.duration} min</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveType(i)} className="text-destructive h-7 px-2">
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    placeholder="e.g. Follow-up"
                    value={newTypeName}
                    onChange={e => setNewTypeName(e.target.value)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Duration (min)</Label>
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    value={newTypeDuration}
                    onChange={e => setNewTypeDuration(parseInt(e.target.value) || 30)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleAddType} disabled={!newTypeName.trim()}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={() => (step === 0 ? handleClose(false) : setStep(step - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 2 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 ? !canProceedStep0 : !canProceedStep1}
            >
              Next
            </Button>
          ) : (
            <Button onClick={handleFinish} disabled={!canFinish}>
              Create Tool
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
