import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Search, Settings, BookOpen, Wrench, Webhook, Copy, Plus, Trash2, PhoneForwarded } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import AgentKnowledgeBase from "@/components/agent-tabs/AgentKnowledgeBase";
import AgentCustomTools from "@/components/agent-tabs/AgentCustomTools";
import AgentWebhooks from "@/components/agent-tabs/AgentWebhooks";
import AgentCalendarIntegrations from "@/components/agent-tabs/AgentCalendarIntegrations";

interface ForwardingNumber {
  id: string;
  phone_number: string;
  label: string | null;
  priority: number;
}


interface UltravoxVoice {
  voiceId: string;
  name: string;
  description?: string;
  previewUrl?: string;
  languageLabel?: string;
  primaryLanguage?: string;
  provider?: string;
}

interface UltravoxModel {
  name: string;
}

const FALLBACK_MODELS: UltravoxModel[] = [
  { name: "fixie-ai/ultravox-v0.7" },
  { name: "fixie-ai/ultravox-v0.5" },
];

const GEMINI_MODELS: UltravoxModel[] = [
  { name: "gemini-2.5-flash-native-audio-preview-12-2025" },
  { name: "gemini-2.5-flash-native-audio-preview-09-2025" },
];

const GEMINI_VOICES = [
  { value: "Kore", label: "Kore (Female)" },
  { value: "Aoede", label: "Aoede (Female)" },
  { value: "Leda", label: "Leda (Female)" },
  { value: "Autonoe", label: "Autonoe (Female)" },
  { value: "Erinome", label: "Erinome (Female)" },
  { value: "Laomedeia", label: "Laomedeia (Female)" },
  { value: "Callirrhoe", label: "Callirrhoe (Female)" },
  { value: "Despina", label: "Despina (Female)" },
  { value: "Puck", label: "Puck (Male)" },
  { value: "Charon", label: "Charon (Male)" },
  { value: "Fenrir", label: "Fenrir (Male)" },
  { value: "Orus", label: "Orus (Male)" },
  { value: "Vale", label: "Vale (Male)" },
  { value: "Zephyr", label: "Zephyr (Male)" },
  { value: "Umbriel", label: "Umbriel (Male)" },
  { value: "Schedar", label: "Schedar (Male)" },
  { value: "Achird", label: "Achird (Male)" },
  { value: "Sadachbia", label: "Sadachbia (Male)" },
  { value: "Sadaltager", label: "Sadaltager (Male)" },
  { value: "Iapetus", label: "Iapetus (Male)" },
];

const SARVAM_MODELS: UltravoxModel[] = [
  { name: "sarvam-m" },
  { name: "sarvam-30b" },
  { name: "sarvam-105b" },
  { name: "sarvam-105b-32k" },
];

const SARVAM_VOICES = [
  { value: "meera", label: "Meera (Female, Hindi)" },
  { value: "arvind", label: "Arvind (Male, Hindi)" },
  { value: "amol", label: "Amol (Male, Hindi)" },
  { value: "kalpana", label: "Kalpana (Female, Hindi)" },
  { value: "shubh", label: "Shubh (Male, Hindi)" },
  { value: "diya", label: "Diya (Female, Hindi)" },
  { value: "neel", label: "Neel (Male, Hindi)" },
  { value: "misha", label: "Misha (Female, Hindi)" },
];

const SARVAM_LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "ta-IN", label: "Tamil" },
  { value: "te-IN", label: "Telugu" },
  { value: "kn-IN", label: "Kannada" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "bn-IN", label: "Bengali" },
  { value: "gu-IN", label: "Gujarati" },
  { value: "mr-IN", label: "Marathi" },
  { value: "pa-IN", label: "Punjabi" },
  { value: "od-IN", label: "Odia" },
  { value: "ur-IN", label: "Urdu" },
  { value: "unknown", label: "Auto-detect" },
];

const AI_PROVIDERS = [
  { value: "ultravox", label: "MagicTeams" },
  { value: "sarvam", label: "Sarvam AI" },
  { value: "gemini", label: "Gemini Live API (Coming Soon)", disabled: true },
];

const FIRST_SPEAKER_OPTIONS = [
  { value: "FIRST_SPEAKER_AGENT", label: "Agent speaks first (inbound)" },
  { value: "FIRST_SPEAKER_USER", label: "User speaks first (outbound)" },
];

export default function AgentForm() {
  const { id } = useParams();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [phoneConfigs, setPhoneConfigs] = useState<Tables<"phone_configs">[]>([]);
  const [voices, setVoices] = useState<UltravoxVoice[]>([]);
  const [models, setModels] = useState<UltravoxModel[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [useCustomVoice, setUseCustomVoice] = useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [ultravoxAgentId, setUltravoxAgentId] = useState<string | null>(null);
  const [forwardingNumbers, setForwardingNumbers] = useState<ForwardingNumber[]>([]);
  const [newFwdLabel, setNewFwdLabel] = useState("");
  const [newFwdNumber, setNewFwdNumber] = useState("");
  
  const [form, setForm] = useState({
    name: "",
    system_prompt: "You are a helpful and friendly receptionist. Answer questions about the business, take messages, and help callers with their needs.",
    voice: "terrence",
    temperature: 0.7,
    first_speaker: "FIRST_SPEAKER_AGENT",
    language_hint: "en",
    max_duration: 300,
    is_active: true,
    phone_number_id: null as string | null,
    model: "fixie-ai/ultravox-v0.7",
    ai_provider: "ultravox",
  });

  useEffect(() => {
    if (!user) return;
    supabase.from("phone_configs").select("*").then(({ data }) => setPhoneConfigs(data || []));

    supabase.functions.invoke("list-ultravox-voices").then(({ data, error }) => {
      setLoadingVoices(false);
      if (error || !data) { setModels(FALLBACK_MODELS); return; }
      if (data.voices && Array.isArray(data.voices)) setVoices(data.voices);
      if (data.models && Array.isArray(data.models)) {
        const fetched = data.models as UltravoxModel[];
        const fetchedNames = new Set(fetched.map(m => m.name));
        setModels([...fetched, ...FALLBACK_MODELS.filter(fm => !fetchedNames.has(fm.name))]);
      } else setModels(FALLBACK_MODELS);
    });

    if (isEditing) {
      supabase.from("agents").select("*").eq("id", id).single().then(async ({ data }) => {
        if (data) {
          const existingBotId = (data as any).ultravox_agent_id || null;

          setForm({
            name: data.name, system_prompt: data.system_prompt, voice: data.voice,
            temperature: Number(data.temperature), first_speaker: data.first_speaker,
            language_hint: data.language_hint || "en", max_duration: data.max_duration || 300,
            is_active: data.is_active, phone_number_id: data.phone_number_id,
            model: (data as any).model || "fixie-ai/ultravox-v0.7",
            ai_provider: (data as any).ai_provider || "ultravox",
          });
          setUltravoxAgentId(existingBotId);

          if ((data as any).ai_provider === "ultravox" && !existingBotId) {
            const { data: syncData } = await supabase.functions.invoke("sync-ultravox-agent", {
              body: { agent_id: data.id },
            });
            if (syncData?.ultravox_agent_id) {
              setUltravoxAgentId(syncData.ultravox_agent_id);
            }
          }
        }
      });

      // Fetch forwarding numbers ordered by priority
      supabase.from("call_forwarding_numbers").select("id, phone_number, label, priority").eq("agent_id", id)
        .order("priority", { ascending: true })
        .then(({ data }) => setForwardingNumbers(data || []));
    }
  }, [user, id]);

  useEffect(() => {
    if ((voices.length > 0 || GEMINI_VOICES.length > 0 || SARVAM_VOICES.length > 0) && form.voice) {
      const isKnownVoice = voices.some(v => v.voiceId === form.voice || v.name === form.voice)
        || GEMINI_VOICES.some(v => v.value === form.voice)
        || SARVAM_VOICES.some(v => v.value === form.voice);
      if (!isKnownVoice && form.voice !== "terrence") setUseCustomVoice(true);
    }
  }, [voices, form.voice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const payload = { ...form, user_id: user.id };

    let savedAgentId = id;

    if (isEditing) {
      const { error } = await supabase.from("agents").update(payload).eq("id", id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setLoading(false); return; }
    } else {
      const { data: newAgent, error } = await supabase.from("agents").insert(payload).select("id").single();
      if (error || !newAgent) { toast({ title: "Error", description: error?.message || "Failed to create agent", variant: "destructive" }); setLoading(false); return; }
      savedAgentId = newAgent.id;
    }

    // Sync with Ultravox backend
    if (form.ai_provider === "ultravox" && savedAgentId) {
      try {
        const { data: syncData, error: syncError } = await supabase.functions.invoke("sync-ultravox-agent", {
          body: { agent_id: savedAgentId },
        });
        if (syncError || syncData?.error) {
          const errMsg = syncError?.message || syncData?.error || "Unknown sync error";
          console.error("Ultravox sync error:", errMsg, syncData?.details);
          
          // Rollback: delete the newly created agent if sync failed on creation
          if (!isEditing && savedAgentId) {
            await supabase.from("agents").delete().eq("id", savedAgentId);
            toast({ title: "Agent creation failed", description: `Backend sync failed: ${errMsg}. The agent was not saved. Please try again.`, variant: "destructive" });
            setLoading(false);
            return;
          }
          
          toast({ title: "Warning", description: `Agent saved but backend sync failed: ${errMsg}`, variant: "destructive" });
        } else if (syncData?.ultravox_agent_id) {
          setUltravoxAgentId(syncData.ultravox_agent_id);
        }
      } catch (err: any) {
        console.error("Ultravox sync error:", err);
        // Rollback on creation
        if (!isEditing && savedAgentId) {
          await supabase.from("agents").delete().eq("id", savedAgentId);
          toast({ title: "Agent creation failed", description: "Backend sync failed. The agent was not saved. Please try again.", variant: "destructive" });
          setLoading(false);
          return;
        }
      }
    }

    setLoading(false);
    toast({ title: isEditing ? "Agent updated" : "Agent created" });
    if (!isEditing) navigate("/agents");
  };


  const allVoices = useMemo(() => {
    if (form.ai_provider === "gemini") {
      return GEMINI_VOICES.map(v => ({ voiceId: v.value, name: v.value, description: v.label, languageLabel: "Gemini Native", provider: "gemini" } as UltravoxVoice));
    }
    if (form.ai_provider === "sarvam") {
      return SARVAM_VOICES.map(v => ({ voiceId: v.value, name: v.value, description: v.label, languageLabel: "Sarvam AI", provider: "sarvam" } as UltravoxVoice));
    }
    return voices;
  }, [voices, form.ai_provider]);

  const filteredVoices = useMemo(() => {
    if (!voiceSearch.trim()) return allVoices;
    const q = voiceSearch.toLowerCase();
    return allVoices.filter(v => v.name.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q) || v.languageLabel?.toLowerCase().includes(q));
  }, [allVoices, voiceSearch]);

  const currentVoiceName = useMemo(() => {
    const found = allVoices.find(v => v.voiceId === form.voice || v.name === form.voice);
    return found ? `${found.name} ${found.languageLabel || ""}` : form.voice;
  }, [allVoices, form.voice]);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/agents")}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{isEditing ? form.name || "Edit Agent" : "Create Agent"}</h1>
            <p className="text-muted-foreground mt-1">Configure your AI receptionist.</p>
          </div>
        </div>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general" className="flex items-center gap-2"><Settings className="h-4 w-4" /><span className="hidden sm:inline">General</span></TabsTrigger>
            <TabsTrigger value="knowledge" className="flex items-center gap-2" disabled={!isEditing}><BookOpen className="h-4 w-4" /><span className="hidden sm:inline">Knowledge</span></TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center gap-2" disabled={!isEditing}><Wrench className="h-4 w-4" /><span className="hidden sm:inline">Tools</span></TabsTrigger>
            <TabsTrigger value="webhooks" className="flex items-center gap-2" disabled={!isEditing}><Webhook className="h-4 w-4" /><span className="hidden sm:inline">Webhooks</span></TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Agent Name</Label>
                    <Input id="name" placeholder="e.g. Front Desk Receptionist" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="prompt">System Prompt</Label>
                      <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setPromptDialogOpen(true)}>
                        Expand ↗
                      </Button>
                    </div>
                    <Textarea id="prompt" placeholder="Describe how your receptionist should behave..." value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })} rows={6} required className="cursor-pointer" onClick={() => setPromptDialogOpen(true)} readOnly />
                    <p className="text-xs text-muted-foreground">Click to expand and edit the full prompt.</p>
                    <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
                      <DialogContent className="sm:max-w-2xl max-h-[80vh]">
                        <DialogHeader><DialogTitle>System Prompt</DialogTitle></DialogHeader>
                        <Textarea value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })} rows={20} className="min-h-[400px] text-sm" />
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5"><Label>Active</Label><p className="text-xs text-muted-foreground">Enable this agent to receive calls</p></div>
                    <Switch checked={form.is_active} onCheckedChange={val => setForm({ ...form, is_active: val })} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>AI Provider & Model</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {isEditing && form.ai_provider === "ultravox" && ultravoxAgentId && (
                    <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                      <Label className="text-sm font-semibold">Bot ID</Label>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-background px-2 py-1 rounded border flex-1 truncate">{ultravoxAgentId}</code>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => {
                          navigator.clipboard.writeText(ultravoxAgentId);
                          toast({ title: "Bot ID copied" });
                        }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>AI Provider</Label>
                    <Select value={form.ai_provider} onValueChange={val => {
                      const defaults = val === "gemini"
                        ? { model: "gemini-2.5-flash-preview-native-audio", voice: "Puck" }
                        : val === "sarvam"
                        ? { model: "sarvam-m", voice: "meera", language_hint: "en-IN" }
                        : { model: "fixie-ai/ultravox-v0.7", voice: "terrence" };
                      setForm({ ...form, ai_provider: val, ...defaults });
                      setUseCustomVoice(false);
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{AI_PROVIDERS.map(p => <SelectItem key={p.value} value={p.value} disabled={(p as any).disabled}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Model</Label>
                    {form.ai_provider === "gemini" ? (
                      <Select value={form.model} onValueChange={val => setForm({ ...form, model: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{GEMINI_MODELS.map(m => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : form.ai_provider === "sarvam" ? (
                      <Select value={form.model} onValueChange={val => setForm({ ...form, model: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{SARVAM_MODELS.map(m => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : loadingVoices ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading models...</div>
                    ) : models.length > 0 ? (
                      <Select value={form.model} onValueChange={val => setForm({ ...form, model: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{models.map(m => <SelectItem key={m.name} value={m.name}>{m.name.replace('fixie-ai/', '').replace('ultravox-', 'MagicTeams ')}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="MagicTeams v0.7" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Voice</Label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Custom (ElevenLabs)</span>
                        <Switch checked={useCustomVoice} onCheckedChange={val => {
                          setUseCustomVoice(val);
                          if (!val) {
                            if (form.ai_provider === "gemini") setForm({ ...form, voice: "Kore" });
                            else if (voices.length > 0) setForm({ ...form, voice: voices[0].name });
                          }
                        }} />
                      </div>
                    </div>
                    {useCustomVoice ? (
                      <div className="space-y-2">
                        <Input value={form.voice} onChange={e => setForm({ ...form, voice: e.target.value })} placeholder="Enter ElevenLabs voice ID" />
                        <p className="text-xs text-muted-foreground">Paste your ElevenLabs voice ID for a custom voice.</p>
                      </div>
                    ) : loadingVoices && form.ai_provider !== "gemini" ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading voices...</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input className="pl-9" placeholder="Search voices..." value={voiceSearch} onChange={e => setVoiceSearch(e.target.value)} />
                        </div>
                        <Select value={form.voice} onValueChange={val => setForm({ ...form, voice: val })}>
                          <SelectTrigger><SelectValue>{currentVoiceName}</SelectValue></SelectTrigger>
                          <SelectContent className="max-h-72">
                            {filteredVoices.length === 0 ? (
                              <div className="p-3 text-sm text-muted-foreground text-center">No voices found</div>
                            ) : filteredVoices.map(v => (
                              <SelectItem key={v.voiceId} value={v.name}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{v.name} {v.languageLabel || ""}</span>
                                  {v.description && <span className="text-xs text-muted-foreground line-clamp-1">{v.description}</span>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>First Speaker</Label>
                    <Select value={form.first_speaker} onValueChange={val => setForm({ ...form, first_speaker: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FIRST_SPEAKER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Temperature: {form.temperature}</Label>
                    <Slider value={[form.temperature]} onValueChange={([val]) => setForm({ ...form, temperature: val })} min={0} max={1} step={0.1} />
                    <p className="text-xs text-muted-foreground">Lower = more focused, higher = more creative</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Language</Label>
                      <Input value={form.language_hint} onChange={e => setForm({ ...form, language_hint: e.target.value })} placeholder="en" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Duration (seconds)</Label>
                      <Input type="number" value={form.max_duration} onChange={e => setForm({ ...form, max_duration: parseInt(e.target.value) || 300 })} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Phone Number</CardTitle></CardHeader>
                <CardContent>
                  {phoneConfigs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No phone numbers configured yet. <a href="/phone-config" className="text-primary hover:underline">Add one first</a>.</p>
                  ) : (
                    <Select value={form.phone_number_id || "none"} onValueChange={val => setForm({ ...form, phone_number_id: val === "none" ? null : val })}>
                      <SelectTrigger><SelectValue placeholder="Select a phone number" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {phoneConfigs.map(pc => <SelectItem key={pc.id} value={pc.id}>{pc.phone_number} {pc.friendly_name ? `(${pc.friendly_name})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </CardContent>
              </Card>

              {isEditing && id && user && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PhoneForwarded className="h-5 w-5" />
                      Call Forwarding
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Add phone numbers the AI agent can transfer calls to. Numbers are tried in order — if the first person is busy or doesn't answer, the call automatically forwards to the next.
                    </p>
                    {forwardingNumbers.length > 0 && (
                      <div className="space-y-2">
                        {forwardingNumbers.map((fwd, index) => (
                          <div key={fwd.id} className="flex items-center gap-3 rounded-md border p-3">
                            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-bold shrink-0">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{fwd.phone_number}</p>
                              {fwd.label && <p className="text-xs text-muted-foreground">{fwd.label}</p>}
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={async () => {
                              await supabase.from("call_forwarding_numbers").delete().eq("id", fwd.id);
                              setForwardingNumbers(prev => prev.filter(f => f.id !== fwd.id));
                              toast({ title: "Forwarding number removed" });
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input placeholder="Label (e.g. Sales)" value={newFwdLabel} onChange={e => setNewFwdLabel(e.target.value)} className="w-32 shrink-0" />
                      <Input placeholder="+1234567890" value={newFwdNumber} onChange={e => setNewFwdNumber(e.target.value)} className="flex-1" />
                      <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={!newFwdNumber.trim()} onClick={async () => {
                        const nextPriority = forwardingNumbers.length > 0 ? Math.max(...forwardingNumbers.map(f => f.priority)) + 1 : 0;
                        const { data: inserted, error } = await supabase.from("call_forwarding_numbers").insert({
                          agent_id: id,
                          user_id: user.id,
                          phone_number: newFwdNumber.trim(),
                          label: newFwdLabel.trim() || null,
                          priority: nextPriority,
                        }).select("id, phone_number, label, priority").single();
                        if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
                        if (inserted) setForwardingNumbers(prev => [...prev, inserted]);
                        setNewFwdNumber("");
                        setNewFwdLabel("");
                        toast({ title: "Forwarding number added" });
                      }}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={loading}>{loading ? "Saving..." : isEditing ? "Update Agent" : "Create Agent"}</Button>
                <Button type="button" variant="outline" onClick={() => navigate("/agents")}>Cancel</Button>
              </div>
            </form>
          </TabsContent>

          {isEditing && id && user && (
            <>
              <TabsContent value="knowledge" className="mt-6">
                <Card>
                  <CardHeader><CardTitle>Knowledge Base</CardTitle></CardHeader>
                  <CardContent><AgentKnowledgeBase agentId={id} userId={user.id} /></CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="tools" className="mt-6 space-y-6">
                <Card>
                  <CardHeader><CardTitle>Appointment Tools</CardTitle></CardHeader>
                  <CardContent><AgentCalendarIntegrations agentId={id} userId={user.id} /></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Custom Tools</CardTitle></CardHeader>
                  <CardContent><AgentCustomTools agentId={id} agentName={form.name} userId={user.id} /></CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="webhooks" className="mt-6">
                <Card>
                  <CardHeader><CardTitle>Webhooks</CardTitle></CardHeader>
                  <CardContent><AgentWebhooks agentId={id} agentName={form.name} userId={user.id} /></CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
