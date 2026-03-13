import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const PARAM_LOCATIONS = ["Body", "Header", "Query"];

interface Agent {
  id: string;
  name: string;
}

const PARAM_TYPES = ["string", "number", "integer", "boolean"];

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
  };

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

  const handleSave = async () => {
    if (!name || !agentId || !httpUrl) {
      toast({ title: "Missing fields", description: "Name, Agent, and Base URL are required.", variant: "destructive" });
      return;
    }
    setSaving(true);

    const parameters = dynamicParams.map((p) => {
      const schemaObj = { type: p.type, description: p.description };
      return { name: p.name, location: p.location.toLowerCase(), required: p.required, schema: schemaObj };
    });

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" /> Add Tool</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create Tool</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Name */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              Name
              <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Display name for this tool</TooltipContent></Tooltip>
            </Label>
            <Input placeholder="Tool Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Model Tool Name + Timeout */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="font-semibold">Model Tool Name</Label>
              <Input placeholder="ex: getWeather" value={modelToolName} onChange={(e) => setModelToolName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">Timeout</Label>
              <Input placeholder="20s" value={timeout} onChange={(e) => setTimeout(e.target.value)} />
            </div>
          </div>

          {/* Agent */}
          <div className="space-y-2">
            <Label className="font-semibold">Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              Description
              <Tooltip><TooltipTrigger asChild><HelpCircle className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Describe what this tool does so the AI knows when to use it</TooltipContent></Tooltip>
            </Label>
            <Textarea placeholder="What this tool does and how it should be used" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>

          {/* Dynamic Parameters */}
          <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Dynamic Parameters</p>
                <p className="text-xs text-muted-foreground">Parameters provided at runtime</p>
              </div>
              <Button variant="outline" size="sm" onClick={addDynamicParam}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
            </div>
            {dynamicParams.length === 0 && (
              <p className="text-sm text-muted-foreground">No dynamic parameters defined.</p>
            )}
            {dynamicParams.map((param, i) => (
              <div key={i} className="rounded-md border p-4 space-y-3 bg-background">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">Parameter {i + 1}</p>
                  <Button variant="ghost" size="sm" className="text-destructive h-auto p-0" onClick={() => removeDynamicParam(i)}>Remove</Button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={param.name} onChange={(e) => updateDynamicParam(i, "name", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Select value={param.location} onValueChange={(v) => updateDynamicParam(i, "location", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PARAM_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={param.type} onValueChange={(v) => updateDynamicParam(i, "type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PARAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={param.required} onCheckedChange={(v) => updateDynamicParam(i, "required", !!v)} id={`req-${i}`} />
                  <Label htmlFor={`req-${i}`} className="text-sm">Required</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input placeholder="Describe what this parameter is for" value={param.description} onChange={(e) => updateDynamicParam(i, "description", e.target.value)} />
                </div>
              </div>
            ))}
          </div>

          {/* Static Parameters */}
          <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Static Parameters</p>
                <p className="text-xs text-muted-foreground">Parameters sent on every call</p>
              </div>
              <Button variant="outline" size="sm" onClick={addStaticParam}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
            </div>
            {staticParams.length === 0 && (
              <p className="text-sm text-muted-foreground">No static parameters defined.</p>
            )}
            {staticParams.map((param, i) => (
              <div key={i} className="rounded-md border p-4 space-y-3 bg-background">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm">Parameter {i + 1}</p>
                  <Button variant="ghost" size="sm" className="text-destructive h-auto p-0" onClick={() => removeStaticParam(i)}>Remove</Button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={param.name} onChange={(e) => updateStaticParam(i, "name", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Select value={param.location} onValueChange={(v) => updateStaticParam(i, "location", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PARAM_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Value</Label>
                    <Input value={param.value} onChange={(e) => updateStaticParam(i, "value", e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* HTTP Settings */}
          <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
            <p className="font-semibold">HTTP Settings</p>
            <div className="space-y-2">
              <Label className="text-xs">Base URL Pattern</Label>
              <Input placeholder="https://api.example.com/resource" value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">HTTP Method</Label>
              <Select value={httpMethod} onValueChange={setHttpMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Discard</Button>
            <Button onClick={handleSave} disabled={saving || !name || !agentId || !httpUrl}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
