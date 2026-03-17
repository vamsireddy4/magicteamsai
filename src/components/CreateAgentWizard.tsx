import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Bot, Sparkles, FileText, Check, ChevronLeft, Loader2, Plus, Home, Shield, ShoppingBag, GraduationCap, Stethoscope, Globe, ClipboardList, Calendar, FileCheck, Package, Zap, HeartPulse, UserRound, GraduationCap as School, BookOpen as Book, Landmark, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

const INDUSTRIES = [
  { id: "real-estate", name: "Real Estate", icon: Home, description: "Property inquiries, viewings, and follow-ups" },
  { id: "insurance", name: "Insurance", icon: Shield, description: "Policy quotes, renewals, and claims" },
  { id: "ecommerce", name: "E-commerce", icon: ShoppingBag, description: "Product recommendations and order support" },
  { id: "education", name: "Education", icon: GraduationCap, description: "Course enrollment and student support" },
  { id: "healthcare", name: "Healthcare", icon: Stethoscope, description: "Appointment scheduling and reminders" },
  { id: "other", name: "Other", icon: Globe, description: "Specify your custom business industry" },
];

const TEMPLATES: Record<string, { id: string; name: string; icon: any; description: string; prompt: string }[]> = {
  "real-estate": [
    { id: "re-inquiry", name: "Property Inquiry Agent", icon: Home, description: "Handles property questions and schedules viewings", prompt: "You are a Real Estate Property Inquiry Agent for 'Ever AI'. Your goal is to provide details about properties and help callers schedule viewings. Be professional, informative, and encouraging. Focus on gathering the caller's budget, preferred location, and timeline. Once you have their info, offer to schedule a viewing based on the available slots." },
    { id: "re-followup", name: "Listing Follow-up Agent", icon: ClipboardList, description: "Follows up with potential buyers after viewings", prompt: "You are a Real Estate Follow-up Agent. Your goal is to reach out to potential buyers who recently viewed a property, gather feedback, and answer any lingering questions. If they are interested, try to schedule a second viewing or a call with the lead agent." },
    { id: "re-scheduler", name: "Open House Scheduler", icon: Calendar, description: "Schedules open house appointments", prompt: "You are an Open House Scheduler. Your goal is to manage the calendar for open house events and confirm attendance with interested parties. Provide the address, time, and parking details for the open house." },
  ],
  "insurance": [
    { id: "ins-quotes", name: "Quote Assistant", icon: FileCheck, description: "Helps users get insurance quotes", prompt: "You are an Insurance Quote Assistant. Your goal is to collect necessary information to provide accurate insurance quotes for auto, home, or life insurance. Be thorough but concise. Remind them that quotes are estimates subject to verification." },
    { id: "ins-claims", name: "Claims Support", icon: Shield, description: "Assists with filing and checking insurance claims", prompt: "You are an Insurance Claims Support Agent. Your goal is to guide users through the process of filing a claim. Collect the policy number, date of incident, and a brief description. Provide a claim reference number at the end." },
  ],
  "ecommerce": [
    { id: "eco-support", name: "Order Support", icon: Package, description: "Tracks orders and handles returns", prompt: "You are an E-commerce Order Support Agent. Assist customers with tracking their orders, processing returns, and answering product availability questions. Always ask for the Order Number first." },
    { id: "eco-sales", name: "Product Recommender", icon: Sparkles, description: "Helps customers find the right products", prompt: "You are a Personal Shopping Assistant. Ask questions about the customer's preferences, budget, and needs to recommend the best products from our catalog." },
  ],
  "healthcare": [
    { id: "hc-appt", name: "Appointment Scheduler", icon: Calendar, description: "Schedules doctor appointments", prompt: "You are a Healthcare Appointment Scheduler. Help patients book appointments with their doctors. Ensure you verify their insurance provider and the reason for the visit. Maintain a HIPAA-compliant professional tone." },
    { id: "hc-remind", name: "Patient Follow-up", icon: HeartPulse, description: "Follows up after appointments", prompt: "You are a Patient Care Representative. Call patients after their appointments to check on their recovery, remind them of follow-up tasks, and answer any non-medical scheduling questions." },
  ],
  "education": [
    { id: "edu-enroll", name: "Admissions Counselor", icon: UserRound, description: "Assists with course enrollment", prompt: "You are an Admissions Counselor. Help prospective students understand course requirements, tuition fees, and enrollment deadlines. Encourage them to schedule a detailed counseling session." },
    { id: "edu-support", name: "Student Success Agent", icon: School, description: "Provides student support services", prompt: "You are a Student Success Assistant. Help current students navigate campus resources, find tutor schedules, and understand academic policies." },
  ],
  "other": [
    { id: "gen-assistant", name: "General Assistant", icon: Bot, description: "A versatile agent for various tasks", prompt: "You are a helpful and friendly AI assistant designed to handle general inquiries and support." }
  ],
};

const DEFAULT_TEMPLATES = [
  { id: "gen-assistant", name: "General Assistant", icon: Bot, description: "A versatile agent for various tasks", prompt: "You are a helpful and friendly AI assistant designed to handle general inquiries and support." }
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

export default function CreateAgentWizard({ open, onOpenChange, userId }: Props) {
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState<string | null>(null);
  const [customIndustry, setCustomIndustry] = useState("");
  const [template, setTemplate] = useState<any | null>(null);
  const [configMode, setConfigMode] = useState<"ai" | "manual" | null>(null);
  const [botName, setBotName] = useState("");
  const [botDescription, setBotDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [userGeminiKey, setUserGeminiKey] = useState<string | null>(null);

  const { toast } = useToast();
  const navigate = useNavigate();

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  const reset = () => {
    setStep(1);
    setIndustry(null);
    setCustomIndustry("");
    setTemplate(null);
    setConfigMode(null);
    setBotName("");
    setBotDescription("");
  };

  useEffect(() => {
    if (!open) reset();
    else if (userId) {
      // Fetch user's gemini key from profile
      supabase
        .from("profiles")
        .select("gemini_api_key")
        .eq("user_id", userId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.gemini_api_key) {
            setUserGeminiKey(data.gemini_api_key);
          }
        });
    }
  }, [open, userId]);

  const selectIndustry = (id: string) => {
    setIndustry(id);
    if (id !== "other") {
      handleNext();
    }
  };

  const selectTemplate = (t: any) => {
    setTemplate(t);
    setBotName(t.name);
    setBotDescription(t.prompt);
    handleNext();
  };

  const selectConfigMode = (mode: "ai" | "manual") => {
    setConfigMode(mode);
    handleNext();
  };

  const generatePrompt = async () => {
    if (!botName) {
      toast({ title: "Name required", description: "Please enter a bot name first." });
      return;
    }
    setIsGenerating(true);
    
    const requestBody = { 
      name: botName, 
      context: industry === "other" ? customIndustry : industry,
      description: botDescription || (template?.description),
      userGeminiKey: userGeminiKey // Pass user's unique key if they have one
    };

    try {
      // 1. Try backend Edge Function first
      const { data, error } = await supabase.functions.invoke("generate-prompt", {
        body: requestBody
      });
      
      if (data?.prompt) {
        setBotDescription(data.prompt);
        toast({ title: "AI Prompt Generated ✨" });
        setIsGenerating(false);
        return;
      } else if (error) {
        console.warn("Edge Function failed, falling back to frontend...");
      }
    } catch (err) {
      console.warn("Edge Function unreachable, falling back to frontend...", err);
    }

    // 2. Frontend Fallback (Smart Fallback)
    try {
      const geminiKey = userGeminiKey || import.meta.env.VITE_GEMINI_API_KEY;
      if (!geminiKey) throw new Error("No API key available");

      const prompt = `You are an expert at writing system prompts for AI voice agents.
Create a highly detailed and effective system prompt for a voice agent with the following details:
- Agent Name: ${requestBody.name}
- Industry/Context: ${requestBody.context || "General"}
- Primary Task/Description: ${requestBody.description || "Be a helpful assistant"}

The system prompt must be optimized for voice-to-voice interaction. 
Include Persona, Objectives, Strict Voice Constraints (e.g. no markdown), and Interaction Rules.
Write ONLY the system prompt text.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error (${response.status})`);
      }

      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (text) {
        setBotDescription(text);
        toast({ title: "AI Prompt Generated (Local) ✨" });
      } else {
        throw new Error("Local fallback failed to return content");
      }
    } catch (err: any) {
      console.error("AI Generation failed entirely:", err);
      toast({ 
        title: "Generation failed", 
        description: err.message || "Please check your connectivity or try again later.", 
        variant: "destructive" 
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const createBot = async () => {
    if (!botName || !botDescription) return;
    setIsCreating(true);
    try {
      const { data, error } = await supabase.from("agents").insert({
        user_id: userId,
        name: botName,
        system_prompt: botDescription,
        is_active: true,
        voice: "terrence",
        ai_provider: "ultravox",
        model: "fixie-ai/ultravox-v0.7"
      }).select("id").single();

      if (error) throw error;

      toast({ title: "Agent created successfully!" });
      onOpenChange(false);
      navigate(`/agents/${data.id}`);
      
      // Background sync
      supabase.functions.invoke("sync-ultravox-agent", {
        body: { agent_id: data.id }
      }).catch(e => console.error("Final sync failed:", e));

    } catch (err: any) {
      toast({ title: "Error creating agent", description: err.message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] p-0 overflow-hidden bg-white border-none shadow-2xl rounded-2xl">
        <div className="flex flex-col h-full max-h-[90vh]">
          {/* Header */}
          <div className="px-8 py-6 border-b bg-white flex items-center justify-between">
            <div className="flex items-center gap-4">
              {step > 1 && (
                <Button variant="ghost" size="icon" onClick={handleBack} className="h-9 w-9 rounded-full hover:bg-slate-100">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              )}
              <div>
                <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">
                  {step === 1 && "Select Industry"}
                  {step === 2 && "Choose Template"}
                  {step === 3 && "Configure Prompt"}
                  {step === 4 && "Configure Prompt"}
                </DialogTitle>
                <DialogDescription className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">
                  Step {step} of 4
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-8 py-8 bg-slate-50/50">
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {INDUSTRIES.map((item) => (
                    <Card 
                      key={item.id} 
                      className={`cursor-pointer border-slate-100 shadow-sm transition-all group relative overflow-hidden bg-white ${industry === item.id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/30 hover:shadow-md'}`}
                      onClick={() => selectIndustry(item.id)}
                    >
                      <CardContent className="p-5 flex items-start gap-4">
                        <div className={`p-3.5 rounded-2xl transition-colors ${industry === item.id ? 'bg-primary/10 text-primary' : 'bg-slate-50 text-slate-600 group-hover:bg-primary/5 group-hover:text-primary'}`}>
                          <item.icon className="h-7 w-7" />
                        </div>
                        <div className="flex-1">
                          <h3 className={`font-bold text-sm transition-colors ${industry === item.id ? 'text-primary' : 'text-slate-800'}`}>{item.name}</h3>
                          <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                            {item.description}
                          </p>
                          
                          {item.id === "other" && industry === "other" && (
                            <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300" onClick={(e) => e.stopPropagation()}>
                              <Input 
                                placeholder="e.g. Legal, Consulting, etc." 
                                value={customIndustry} 
                                onChange={(e) => setCustomIndustry(e.target.value)}
                                className="h-9 text-xs"
                              />
                              <Button 
                                size="sm" 
                                className="w-full h-8 text-xs font-bold" 
                                disabled={!customIndustry}
                                onClick={handleNext}
                              >
                                Continue <ArrowRight className="h-3 w-3 ml-2" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {(TEMPLATES[industry!] || DEFAULT_TEMPLATES).map((item) => (
                  <Card 
                    key={item.id} 
                    className="cursor-pointer border-slate-100 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group bg-white"
                    onClick={() => selectTemplate(item)}
                  >
                    <CardContent className="p-5 flex items-center gap-5">
                      <div className="bg-slate-50 p-3 rounded-2xl text-slate-600 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
                        <item.icon className="h-6 w-6" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">{item.name}</h3>
                        <p className="text-[12px] text-slate-500 leading-relaxed mt-1">
                          {item.description}
                        </p>
                      </div>
                      <div className="h-8 w-8 rounded-full border border-slate-100 flex items-center justify-center group-hover:bg-primary group-hover:border-primary transition-all">
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-white" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 h-full items-center py-4 animate-in fade-in zoom-in-95 duration-500">
                <Card 
                  className="cursor-pointer border-slate-100 shadow-sm hover:border-primary/30 hover:shadow-lg transition-all h-[260px] flex flex-col items-center justify-center text-center p-8 group bg-white"
                  onClick={() => selectConfigMode("ai")}
                >
                  <div className="h-20 w-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-all scale-100 group-hover:scale-110">
                    <Sparkles className="h-10 w-10 text-primary" />
                  </div>
                  <h3 className="font-bold text-lg text-slate-800 mb-2">Generate with AI</h3>
                  <p className="text-[13px] text-slate-500 leading-relaxed max-w-[180px]">
                    Describe what you want and we&apos;ll write the prompt for you
                  </p>
                </Card>

                <Card 
                  className="cursor-pointer border-slate-100 shadow-sm hover:border-primary/30 hover:shadow-lg transition-all h-[260px] flex flex-col items-center justify-center text-center p-8 group bg-white"
                  onClick={() => selectConfigMode("manual")}
                >
                  <div className="h-20 w-20 rounded-3xl bg-slate-50 flex items-center justify-center mb-6 group-hover:bg-slate-100 transition-all scale-100 group-hover:scale-110">
                    <FileText className="h-10 w-10 text-slate-600" />
                  </div>
                  <h3 className="font-bold text-lg text-slate-800 mb-2">Use Template / Manual</h3>
                  <p className="text-[13px] text-slate-500 leading-relaxed max-w-[180px]">
                    Start with the template prompt or write your own from scratch
                  </p>
                </Card>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="space-y-2">
                  <Label htmlFor="botName" className="text-[13px] font-bold text-slate-700 ml-1">Bot Name</Label>
                  <Input 
                    id="botName" 
                    placeholder="e.g. Property Listing Assistant" 
                    value={botName} 
                    onChange={(e) => setBotName(e.target.value)}
                    className="bg-white border-slate-200 h-12 rounded-xl focus-visible:ring-primary shadow-sm"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <Label htmlFor="botDesc" className="text-[13px] font-bold text-slate-700">Describe your agent</Label>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-[10px] uppercase tracking-tighter font-extrabold h-6 px-2 hover:bg-slate-100"
                      onClick={() => setStep(3)}
                    >
                      Change Mode
                    </Button>
                  </div>
                  <Textarea 
                    id="botDesc" 
                    placeholder="Provide a detailed description of your agent's behavior, persona, and goals..." 
                    value={botDescription} 
                    onChange={(e) => setBotDescription(e.target.value)}
                    className="min-h-[240px] bg-white border-slate-200 text-sm resize-none rounded-xl focus-visible:ring-primary shadow-sm leading-relaxed"
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <Button 
                    variant="outline" 
                    className="flex-1 border-slate-200 h-12 rounded-xl font-bold bg-white hover:bg-slate-50 shadow-sm"
                    onClick={generatePrompt}
                    disabled={isGenerating || !botName}
                  >
                    {isGenerating ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating...</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Generate Prompt</>
                    )}
                  </Button>
                  <Button 
                    className="flex-1 bg-slate-900 hover:bg-slate-800 h-12 rounded-xl font-bold shadow-lg"
                    onClick={createBot}
                    disabled={isCreating || !botName || !botDescription}
                  >
                    {isCreating ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating...</>
                    ) : (
                      "Create Bot"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
