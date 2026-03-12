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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Search, Settings, BookOpen, Wrench, Webhook } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import AgentKnowledgeBase from "@/components/agent-tabs/AgentKnowledgeBase";
import AgentCustomTools from "@/components/agent-tabs/AgentCustomTools";
import AgentWebhooks from "@/components/agent-tabs/AgentWebhooks";


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

const AI_PROVIDERS = [
  { value: "ultravox", label: "Ultravox" },
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
      supabase.from("agents").select("*").eq("id", id).single().then(({ data }) => {
        if (data) {
          setForm({
            name: data.name, system_prompt: data.system_prompt, voice: data.voice,
            temperature: Number(data.temperature), first_speaker: data.first_speaker,
            language_hint: data.language_hint || "en", max_duration: data.max_duration || 300,
            is_active: data.is_active, phone_number_id: data.phone_number_id,
            model: (data as any).model || "fixie-ai/ultravox-v0.7",
            ai_provider: (data as any).ai_provider || "ultravox",
          });
        }
      });
    }
  }, [user, id]);

  useEffect(() => {
    if ((voices.length > 0 || GEMINI_VOICES.length > 0) && form.voice) {
      const isKnownVoice = voices.some(v => v.voiceId === form.voice || v.name === form.voice)
        || GEMINI_VOICES.some(v => v.value === form.voice);
      if (!isKnownVoice && form.voice !== "terrence") setUseCustomVoice(true);
    }
  }, [voices, form.voice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const payload = { ...form, user_id: user.id };
    const { error } = isEditing
      ? await supabase.from("agents").update(payload).eq("id", id)
      : await supabase.from("agents").insert(payload);
    setLoading(false);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: isEditing ? "Agent updated" : "Agent created" }); navigate("/agents"); }
  };

  const allVoices = useMemo(() => {
    if (form.ai_provider === "gemini") {
      return GEMINI_VOICES.map(v => ({ voiceId: v.value, name: v.value, description: v.label, languageLabel: "Gemini Native", provider: "gemini" } as UltravoxVoice));
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
                    <Label htmlFor="prompt">System Prompt</Label>
                    <Textarea id="prompt" placeholder="Describe how your receptionist should behave..." value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })} rows={6} required />
                    <p className="text-xs text-muted-foreground">Instructions that define your receptionist's personality and behavior.</p>
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
                  <div className="space-y-2">
                    <Label>AI Provider</Label>
                    <Select value={form.ai_provider} onValueChange={val => {
                      const defaults = val === "gemini" ? { model: "gemini-2.5-flash-preview-native-audio", voice: "Puck" } : { model: "fixie-ai/ultravox-v0.7", voice: "terrence" };
                      setForm({ ...form, ai_provider: val, ...defaults });
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
                    ) : loadingVoices ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading models...</div>
                    ) : models.length > 0 ? (
                      <Select value={form.model} onValueChange={val => setForm({ ...form, model: val })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{models.map(m => <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="fixie-ai/ultravox-v0.7" />
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
              <TabsContent value="tools" className="mt-6">
                <Card>
                  <CardHeader><CardTitle>Custom Tools</CardTitle></CardHeader>
                  <CardContent><AgentCustomTools agentId={id} agentName={form.name} userId={user.id} /></CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="webhooks" className="mt-6">
                <Card>
                  <CardHeader><CardTitle>Webhooks</CardTitle></CardHeader>
                  <CardContent><AgentWebhooks agentId={id} userId={user.id} /></CardContent>
                </Card>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
