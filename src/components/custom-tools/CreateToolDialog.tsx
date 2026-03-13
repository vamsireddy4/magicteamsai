import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_LOCATIONS = ["Body", "Header", "Query String"];
const PARAM_TYPES = ["String", "Number", "Integer", "Boolean"];

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

interface ToolParam {
  paramType: "Automatic" | "Static";
  name: string;
  description: string;
  required: boolean;
  type: string;
  location: string;
  value: string; // used for Static value or Automatic known value
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

  // Info
  const [name, setName] = useState("");
  const [modelToolName, setModelToolName] = useState("");
  const [timeout, setTimeout] = useState("20s");
  const [description, setDescription] = useState("");

  // Integration
  const [agentId, setAgentId] = useState("");
  const [httpMethod, setHttpMethod] = useState("GET");
  const [httpUrl, setHttpUrl] = useState("");

  // Parameters
  const [params, setParams] = useState<ToolParam[]>([]);
  const [addingParam, setAddingParam] = useState(false);
  const [editParam, setEditParam] = useState<ToolParam>({
    paramType: "Automatic",
    name: "",
    description: "",
    required: false,
    type: "String",
    location: "Body",
    value: "",
  });

  const resetEditParam = () => {
    setEditParam({
      paramType: "Automatic",
      name: "",
      description: "",
      required: false,
      type: "String",
      location: "Body",
      value: "",
    });
  };

  const resetForm = () => {
    setName("");
    setModelToolName("");
    setTimeout("20s");
    setDescription("");
    setAgentId("");
    setHttpMethod("GET");
    setHttpUrl("");
    setParams([]);
    setAddingParam(false);
    resetEditParam();
    setStep(0);
  };

  const handleSaveParam = () => {
    if (!editParam.name) {
      toast({ title: "Parameter name is required", variant: "destructive" });
      return;
    }
    if (editParam.paramType === "Static" && !editParam.value) {
      toast({ title: "Value is required for static parameters", variant: "destructive" });
      return;
    }
    setParams([...params, { ...editParam }]);
    resetEditParam();
    setAddingParam(false);
  };

  const removeParam = (index: number) => {
    setParams(params.filter((_, i) => i !== index));
  };

  // Step validation
  const isStepComplete = (s: number) => {
    switch (s) {
      case 0: return !!name;
      case 1: return !!agentId && !!httpUrl;
      case 2: return true;
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
    if (s === 2) return params.length > 0 ? "complete" : "empty";
    return "empty";
  };

  const canSave = !!name && !!agentId && !!httpUrl;

  const locationToApi = (loc: string) => {
    if (loc === "Query String") return "query";
    return loc.toLowerCase();
  };

  const handleSave = async () => {
    if (!canSave) {
      toast({ title: "Missing fields", description: "Name, Agent, and Base URL are required.", variant: "destructive" });
      return;
    }
    setSaving(true);

    const dynamicParams = params.filter((p) => p.paramType === "Automatic");
    const staticParamsList = params.filter((p) => p.paramType === "Static");

    const parameters = dynamicParams.map((p) => ({
      name: p.name,
      location: locationToApi(p.location),
      required: p.required,
      schema: { type: p.type.toLowerCase(), description: p.description },
    }));

    const headers: Record<string, string> = {};
    const bodyTemplate: Record<string, any> = {};
    staticParamsList.forEach((p) => {
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

  const renderParametersStep = () => {
    if (addingParam) {
      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">Add parameter</h3>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { resetEditParam(); setAddingParam(false); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Parameter type */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">Parameter type</Label>
            <Select value={editParam.paramType} onValueChange={(v) => setEditParam({ ...editParam, paramType: v as "Automatic" | "Static" })}>
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Automatic">
                  <span className="font-medium">{"{ } "}Automatic</span>
                </SelectItem>
                <SelectItem value="Static">
                  <span className="font-medium">{"{ } "}Static</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Parameter name */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">Parameter name<span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. Company"
              value={editParam.name}
              onChange={(e) => setEditParam({ ...editParam, name: e.target.value })}
              className="bg-background"
            />
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-sm">Location:<span className="text-destructive">*</span></Label>
            <Select value={editParam.location} onValueChange={(v) => setEditParam({ ...editParam, location: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAM_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Known Value (Automatic only) */}
          {editParam.paramType === "Automatic" && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">Known Value:<span className="text-destructive">*</span></Label>
              <Select value={editParam.value} onValueChange={(v) => setEditParam({ ...editParam, value: v })}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="Select a Known Value" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call.id">call.id</SelectItem>
                  <SelectItem value="call.caller_number">call.caller_number</SelectItem>
                  <SelectItem value="call.recipient_number">call.recipient_number</SelectItem>
                  <SelectItem value="agent.name">agent.name</SelectItem>
                  <SelectItem value="agent.id">agent.id</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Value (Static only) */}
          {editParam.paramType === "Static" && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-sm">Value</Label>
              <Input
                placeholder="e.g. Ultravox"
                value={editParam.value}
                onChange={(e) => setEditParam({ ...editParam, value: e.target.value })}
                className="bg-background"
              />
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSaveParam} disabled={!editParam.name || (editParam.paramType === "Static" && !editParam.value)}>
              Save
            </Button>
          </div>
        </div>
      );
    }

    // Parameters list view
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-base font-semibold text-foreground mb-1">Parameters</h3>
          <p className="text-sm text-muted-foreground">Define parameters for this tool.</p>
        </div>

        {params.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No parameters defined yet.</p>
            <Button variant="outline" onClick={() => setAddingParam(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add parameter
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {params.map((param, i) => (
              <div key={i} className="rounded-lg border p-4 bg-muted/30 flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{param.name}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full border",
                      param.paramType === "Dynamic"
                        ? "bg-primary/10 text-primary border-primary/20"
                        : "bg-muted text-muted-foreground border-border"
                    )}>
                      {param.paramType}
                    </span>
                    {param.required && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {param.type} · {param.location}
                    {param.description && ` · ${param.description}`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive h-8 w-8 p-0 shrink-0" onClick={() => removeParam(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setAddingParam(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add parameter
            </Button>
          </div>
        )}
      </div>
    );
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
        return renderParametersStep();

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
