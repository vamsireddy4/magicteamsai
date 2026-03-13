import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_LOCATIONS = ["Body", "Header", "Query"];
const PARAM_TYPES = ["string", "number", "integer", "boolean"];

const STEPS = [
  { label: "Info", description: "Name & description" },
  { label: "Integration", description: "Endpoint & agent" },
  { label: "Parameters", description: "Dynamic & static params" },
  { label: "Advanced", description: "Additional settings" },
];

interface Agent {
  id: string;
  name: string;
}

interface DynamicParam {
  name: string;
  location: string;
  required: boolean;
  type: string;
  description: string;
}

interface StaticParam {
  name: string;
  location: string;
  value: string;
}

interface CreateToolDialogProps {
  agents: Agent[];
  userId: string;
  onCreated: () => void;
}

export default function CreateToolDialog({ agents, userId, onCreated }: CreateToolDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [modelToolName, setModelToolName] = useState("");
  const [timeout, setTimeout] = useState("20s");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpUrl, setHttpUrl] = useState("");

  const [dynamicParams, setDynamicParams] = useState<DynamicParam[]>([]);
  const [staticParams, setStaticParams] = useState<StaticParam[]>([]);

  const resetForm = () => {
    setName("");
    setModelToolName("");
    setTimeout("20s");
    setDescription("");
    setAgentId("");
    setHttpMethod("GET");
    setHttpUrl("");
    setDynamicParams([]);
    setStaticParams([]);
    setStep(0);
  };

  // Dynamic params helpers
  const addDynamicParam = () => {
    setDynamicParams([...dynamicParams, { name: "", location: "Body", required: false, type: "string", description: "" }]);
  };
  const removeDynamicParam = (index: number) => {
    setDynamicParams(dynamicParams.filter((_, i) => i !== index));
  };
  const updateDynamicParam = (index: number, field: keyof DynamicParam, value: any) => {
    const updated = [...dynamicParams];
    updated[index] = { ...updated[index], [field]: value };
    setDynamicParams(updated);
  };

  // Static params helpers
  const addStaticParam = () => {
    setStaticParams([...staticParams, { name: "", location: "Body", value: "" }]);
  };
  const removeStaticParam = (index: number) => {
    setStaticParams(staticParams.filter((_, i) => i !== index));
  };
  const updateStaticParam = (index: number, field: keyof StaticParam, value: string) => {
    const updated = [...staticParams];
    updated[index] = { ...updated[index], [field]: value };
    setStaticParams(updated);
  };

  // Step validation
  const isStepComplete = (s: number) => {
    switch (s) {
      case 0: return !!name;
      case 1: return !!agentId && !!httpUrl;
      case 2: return true; // params are optional
      case 3: return true;
      default: return false;
    }
  };

  const getStepStatus = (s: number): "complete" | "incomplete" | "empty" => {
    if (s === 0) return name ? "complete" : "empty";
    if (s === 1) {
      if (agentId && httpUrl) return "complete";
      if (agentId || httpUrl) return "incomplete";
      return "empty";
    }
    if (s === 2) return (dynamicParams.length > 0 || staticParams.length > 0) ? "complete" : "empty";
    return "empty";
  };

  const canSave = !!name && !!agentId && !!httpUrl;

  const handleSave = async () => {
    if (!canSave) {
      toast({ title: "Missing fields", description: "Name, Agent, and Base URL are required.", variant: "destructive" });
      return;
    }
    setSaving(true);

    const parameters = dynamicParams.map((p) => ({
      name: p.name,
      location: p.location.toLowerCase(),
      required: p.required,
      schema: { type: p.type, description: p.description },
    }));

    const headers: Record<string, string> = {};
    const bodyTemplate: Record<string, any> = {};
    staticParams.forEach((p) => {
      if (p.location === "Header") headers[p.name] = p.value;
      else bodyTemplate[p.name] = p.value;
    });

    const { error } = await supabase.from("agent_tools").insert({
      user_id: userId,
      agent_id: agentId,
      name: modelToolName || name,
      description,
      http_method: httpMethod,
      http_url: httpUrl,
      http_headers: headers,
      http_body_template: bodyTemplate,
      parameters,
    } as any);

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Tool created" });
      resetForm();
      setOpen(false);
      onCreated();
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-1">Tool Information</h3>
              <p className="text-sm text-muted-foreground">Basic details about your custom tool.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Tool Name <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Send Summary" value={name} onChange={(e) => setName(e.target.value)} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Model Tool Name</Label>
              <p className="text-xs text-muted-foreground">The identifier the AI model uses (e.g. sendSummary)</p>
              <Input placeholder="e.g. sendSummary" value={modelToolName} onChange={(e) => setModelToolName(e.target.value)} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Description</Label>
              <p className="text-xs text-muted-foreground">Describe what this tool does so the AI knows when to use it.</p>
              <Textarea placeholder="What this tool does and how it should be used" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="bg-background" />
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-1">Integration Settings</h3>
              <p className="text-sm text-muted-foreground">Configure the endpoint and assign to an agent.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Agent <span className="text-destructive">*</span></Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="Select an agent" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground font-medium">Base URL Pattern <span className="text-destructive">*</span></Label>
              <Input placeholder="https://api.example.com/resource" value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} className="bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-foreground font-medium">HTTP Method</Label>
                <Select value={httpMethod} onValueChange={setHttpMethod}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HTTP_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground font-medium">Timeout</Label>
                <Input placeholder="20s" value={timeout} onChange={(e) => setTimeout(e.target.value)} className="bg-background" />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-1">Parameters</h3>
              <p className="text-sm text-muted-foreground">Define dynamic and static parameters for this tool.</p>
            </div>

            {/* Dynamic Parameters */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground text-sm">Dynamic Parameters</p>
                  <p className="text-xs text-muted-foreground">Provided by the AI at runtime</p>
                </div>
                <Button variant="outline" size="sm" onClick={addDynamicParam}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
              {dynamicParams.length === 0 && (
                <p className="text-sm text-muted-foreground py-3 text-center border border-dashed rounded-md">No dynamic parameters defined.</p>
              )}
              {dynamicParams.map((param, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm text-foreground">Parameter {i + 1}</p>
                    <Button variant="ghost" size="sm" className="text-destructive h-auto p-1" onClick={() => removeDynamicParam(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input value={param.name} onChange={(e) => updateDynamicParam(i, "name", e.target.value)} className="bg-background" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select value={param.type} onValueChange={(v) => updateDynamicParam(i, "type", v)}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PARAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Location</Label>
                      <Select value={param.location} onValueChange={(v) => updateDynamicParam(i, "location", v)}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PARAM_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <Input placeholder="Describe this parameter for the AI" value={param.description} onChange={(e) => updateDynamicParam(i, "description", e.target.value)} className="bg-background" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={param.required} onCheckedChange={(v) => updateDynamicParam(i, "required", !!v)} id={`req-${i}`} />
                    <Label htmlFor={`req-${i}`} className="text-sm text-foreground">Required</Label>
                  </div>
                </div>
              ))}
            </div>

            {/* Static Parameters */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground text-sm">Static Parameters</p>
                  <p className="text-xs text-muted-foreground">Sent on every call (e.g. API keys)</p>
                </div>
                <Button variant="outline" size="sm" onClick={addStaticParam}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
              {staticParams.length === 0 && (
                <p className="text-sm text-muted-foreground py-3 text-center border border-dashed rounded-md">No static parameters defined.</p>
              )}
              {staticParams.map((param, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm text-foreground">Parameter {i + 1}</p>
                    <Button variant="ghost" size="sm" className="text-destructive h-auto p-1" onClick={() => removeStaticParam(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input value={param.name} onChange={(e) => updateStaticParam(i, "name", e.target.value)} className="bg-background" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Location</Label>
                      <Select value={param.location} onValueChange={(v) => updateStaticParam(i, "location", v)}>
                        <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PARAM_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Value</Label>
                      <Input value={param.value} onChange={(e) => updateStaticParam(i, "value", e.target.value)} className="bg-background" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold text-foreground mb-1">Advanced Settings</h3>
              <p className="text-sm text-muted-foreground">Additional configuration options.</p>
            </div>
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Advanced settings coming soon.</p>
              <p className="text-xs text-muted-foreground mt-1">Agent end behavior, static responses, and more.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" /> Add Tool</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] p-0 gap-0 overflow-hidden bg-background">
        <div className="flex h-[70vh]">
          {/* Left Sidebar Stepper */}
          <div className="w-52 shrink-0 border-r bg-muted/30 p-5 flex flex-col">
            <h2 className="text-lg font-bold text-foreground mb-1">Create Tool</h2>
            <p className="text-xs text-muted-foreground mb-6">Configure your custom tool</p>

            <nav className="space-y-1 flex-1">
              {STEPS.map((s, i) => {
                const status = getStepStatus(i);
                const isActive = step === i;
                return (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <div className={cn(
                      "h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-xs border",
                      status === "complete" ? "bg-primary border-primary text-primary-foreground" :
                      isActive ? "border-primary text-primary" :
                      "border-muted-foreground/40 text-muted-foreground"
                    )}>
                      {status === "complete" ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-medium truncate", isActive && "text-primary")}>{s.label}</p>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Content Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto p-6">
              {renderStepContent()}
            </div>

            {/* Footer */}
            <div className="border-t p-4 flex items-center justify-between bg-muted/20">
              <Button
                variant="outline"
                onClick={() => {
                  if (step === 0) { resetForm(); setOpen(false); }
                  else setStep(step - 1);
                }}
              >
                {step === 0 ? "Cancel" : "Back"}
              </Button>
              <div className="flex gap-2">
                {step < STEPS.length - 1 ? (
                  <Button onClick={() => setStep(step + 1)} disabled={!isStepComplete(step)}>
                    Next
                  </Button>
                ) : (
                  <Button onClick={handleSave} disabled={saving || !canSave}>
                    {saving ? "Creating..." : "Create Tool"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
