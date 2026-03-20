import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Sparkles, FileText, RefreshCw, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { enhanceAgentPrompt } from "@/lib/gemini";

type StepId = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS = [
  "Welcome",
  "Choose Workflow",
  "Select Strategy",
  "Choose Template",
  "Configure Agent",
];

const INDUSTRIES = [
  {
    id: "real-estate",
    title: "Real Estate",
    description: "Property inquiries, viewings, and follow-ups",
  },
  {
    id: "insurance",
    title: "Insurance",
    description: "Policy quotes, renewals, and claims",
  },
  {
    id: "ecommerce",
    title: "E-commerce",
    description: "Product recommendations and order support",
  },
  {
    id: "education",
    title: "Education",
    description: "Course enrollment and student support",
  },
  {
    id: "healthcare",
    title: "Healthcare",
    description: "Appointment scheduling and reminders",
  },
  {
    id: "other",
    title: "Other",
    description: "Specify your own custom industry",
  },
];

const STRATEGIES_BY_INDUSTRY: Record<string, { id: string; title: string; description: string }[]> = {
  "real-estate": [
    {
      id: "property-inquiry",
      title: "Property Inquiry Agent",
      description: "Handle inbound buyer and tenant questions.",
    },
    {
      id: "listing-follow-up",
      title: "Listing Follow-up Agent",
      description: "Follow up after viewings and qualify leads.",
    },
    {
      id: "open-house",
      title: "Open House Scheduler",
      description: "Book appointments and coordinate site visits.",
    },
  ],
  "insurance": [
    {
      id: "quote-generator",
      title: "Quote Generator Agent",
      description: "Provides insurance quotes based on customer needs.",
    },
    {
      id: "renewal-reminder",
      title: "Renewal Reminder Agent",
      description: "Reminds customers about policy renewals.",
    },
    {
      id: "claims-support",
      title: "Claims Support Agent",
      description: "Assists with insurance claim processes.",
    },
  ],
  "ecommerce": [
    {
      id: "order-status",
      title: "Order Tracking Agent",
      description: "Help customers check their order status and delivery updates.",
    },
    {
      id: "product-questions",
      title: "Product Knowledge Agent",
      description: "Answer specific questions about product features and specs.",
    },
    {
      id: "return-assistant",
      title: "Returns & Exchanges Agent",
      description: "Guide customers through the returns and exchange process.",
    },
  ],
  "healthcare": [
    {
      id: "appointment-booker",
      title: "Appointment Booking Agent",
      description: "Schedule, reschedule, or cancel patient appointments.",
    },
    {
      id: "patient-info",
      title: "Patient Information Agent",
      description: "Provide general info about clinic hours and services.",
    },
    {
      id: "symptom-checker",
      title: "Symptom Triage Agent",
      description: "Screen patient concerns and direct them to the right care.",
    },
  ],
  "other": [
    {
      id: "general-assistant",
      title: "General Assistant",
      description: "A versatile assistant ready to help with any task you define."
    }
  ],
  "education": [
    {
      id: "admissions-bot",
      title: "Admissions Assistant Agent",
      description: "Answer student questions about enrollment and requirements.",
    },
    {
      id: "course-info",
      title: "Course Catalog Agent",
      description: "Provide details about specific programs and curriculums.",
    },
    {
      id: "tutor-match",
      title: "Tutor Matching Agent",
      description: "Help students find the right academic support services.",
    },
  ],
};

const TEMPLATE_MODES = [
  {
    id: "generate",
    title: "Generate with AI",
    description: "Describe what you want and we will create the prompt for you.",
  },
  {
    id: "manual",
    title: "Paste Manually",
    description: "Write or paste your own custom prompt directly.",
  },
];

const VOICES = ["Terrence", "Nova", "Alloy", "Anushka", "Rahul"];
const LANGUAGES = ["English", "Telugu", "Hindi", "Tamil"];

const AI_PROVIDERS = [
  { value: "ultravox", label: "MagicTeams" },
  { value: "sarvam", label: "Sarvam AI" },
  { value: "gemini", label: "Gemini Live API (Coming Soon)", disabled: true },
];

const SARVAM_VOICES = [
  { value: "anushka", label: "Anushka (Female)" },
  { value: "manisha", label: "Manisha (Female)" },
  { value: "vidya", label: "Vidya (Female)" },
  { value: "arya", label: "Arya (Female)" },
  { value: "priya", label: "Priya (Female)" },
  { value: "kavya", label: "Kavya (Female)" },
  { value: "shreya", label: "Shreya (Female)" },
  { value: "shruti", label: "Shruti (Female)" },
  { value: "abhilash", label: "Abhilash (Male)" },
  { value: "karun", label: "Karun (Male)" },
  { value: "hitesh", label: "Hitesh (Male)" },
  { value: "rahul", label: "Rahul (Male)" },
  { value: "amit", label: "Amit (Male)" },
  { value: "dev", label: "Dev (Male)" },
  { value: "shubh", label: "Shubh (Male)" },
  { value: "advait", label: "Advait (Male)" },
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
];

const SARVAM_MODELS = [
  { value: "sarvam-30b", label: "Sarvam 30B" },
];
const ONBOARDING_FLAG_KEY = "magicteams_onboarding_signup_only";

function StepHeader({ step }: { step: StepId }) {
  return (
    <div className="w-full max-w-[1400px] space-y-10 mx-auto">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="absolute inset-y-0 left-0 bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${(step / 5) * 100}%` }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        />
      </div>
      <div className="flex justify-between w-full">
        {STEP_LABELS.map((label, index) => {
          const current = index + 1;
          const complete = current < step;
          const active = current === step;

          return (
            <div key={label} className="flex flex-col items-center gap-2 text-center">
              <motion.div
                initial={false}
                animate={{
                  scale: active ? 1.1 : 1,
                  backgroundColor: complete ? "var(--primary)" : active ? "var(--primary-foreground)" : "var(--muted)",
                  borderColor: active || complete ? "var(--primary)" : "var(--border)",
                  color: complete ? "var(--primary-foreground)" : active ? "var(--primary)" : "var(--muted-foreground)",
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors shadow-sm"
              >
                {complete ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Check className="h-4 w-4" />
                  </motion.div>
                ) : (
                  current
                )}
              </motion.div>
              <span 
                className={[
                  "text-xs transition-colors duration-300 whitespace-nowrap",
                  active ? "font-bold text-foreground" : "text-muted-foreground font-medium",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, profile, completeOnboarding } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<StepId>(1);
  const [industry, setIndustry] = useState<string>("real-estate");
  const [strategy, setStrategy] = useState<string>("property-inquiry");
  const [templateMode, setTemplateMode] = useState<string>("generate");
  const [agentName, setAgentName] = useState("Property Inquiry Agent");
  const [voice, setVoice] = useState("terrence");
  const [language, setLanguage] = useState("en");
  const [aiProvider, setAiProvider] = useState("ultravox");
  const [model, setModel] = useState("fixie-ai/ultravox-v0.7");
  const [welcomeGreeting, setWelcomeGreeting] = useState("Thanks for viewing the property! Any questions?");
  const [agentGoal, setAgentGoal] = useState(
    "You are a follow-up specialist for real estate leads. Ask clear qualifying questions, book appointments when appropriate, and keep the conversation concise.",
  );
  const [customIndustry, setCustomIndustry] = useState("");
  const [voices, setVoices] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  useEffect(() => {
    if (aiProvider === "ultravox") {
      setLoadingVoices(true);
      supabase.functions.invoke("list-ultravox-voices").then(({ data, error }) => {
        setLoadingVoices(false);
        if (error || !data) {
          setModels([{ name: "fixie-ai/ultravox-v0.7" }]);
          return;
        }
        if (data.voices && Array.isArray(data.voices)) setVoices(data.voices);
        if (data.models && Array.isArray(data.models)) setModels(data.models);
      });
    }
  }, [aiProvider]);
  const [submitting, setSubmitting] = useState(false);
  const [modeSelected, setModeSelected] = useState(false);
  const [promptDescription, setPromptDescription] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  
  // New "dashboard sync" states
  const [temperature, setTemperature] = useState(0.7);
  const [firstSpeaker, setFirstSpeaker] = useState("FIRST_SPEAKER_AGENT");
  const [maxDuration, setMaxDuration] = useState(300);

  useEffect(() => {
    if (!user) return;
    const shouldShowOnboarding = sessionStorage.getItem(ONBOARDING_FLAG_KEY) === "true";
    if (!shouldShowOnboarding) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const currentIndustry = useMemo(
    () => INDUSTRIES.find((item) => item.id === industry) ?? INDUSTRIES[0],
    [industry],
  );
  const availableStrategies = useMemo(
    () => STRATEGIES_BY_INDUSTRY[industry] || STRATEGIES_BY_INDUSTRY["real-estate"],
    [industry],
  );

  const currentStrategy = useMemo(
    () => availableStrategies.find((item) => item.id === strategy) ?? availableStrategies[0],
    [strategy, availableStrategies],
  );

  // Reset strategy when industry changes
  useEffect(() => {
    if (availableStrategies.length > 0) {
      setStrategy(availableStrategies[0].id);
      setAgentName(availableStrategies[0].title);
    }
  }, [industry, availableStrategies]);

  const handleEnhanceAndContinue = async () => {
    if (templateMode === "manual") {
      next();
      return;
    }

    if (!promptDescription.trim()) return;

    setIsEnhancing(true);
    toast({
      title: "Enhancing prompt...",
      description: "Gemini is crafting a professional persona for your agent.",
    });

    try {
      const advancedPrompt = await enhanceAgentPrompt({
        industry: currentIndustry.title,
        strategy: currentStrategy.title,
        description: promptDescription,
      }, profile?.gemini_api_key);

      setAgentGoal(advancedPrompt);
      setAgentName(`${currentStrategy.title}`);
      
      toast({
        title: "Prompt Enhanced!",
        description: "Your professional agent persona is ready.",
      });
      
      next();
    } catch (error: any) {
      console.error("Enhancement error:", error);
      
      // Fallback
      const fallbackGoal = `You are a ${currentStrategy.title} for the ${currentIndustry.title} industry. ${promptDescription}`;
      setAgentGoal(fallbackGoal);
      setAgentName(`${currentStrategy.title}`);
      
      toast({
        title: "Enhancement Warning",
        description: `${error.message}. Using basic version instead.`,
        variant: "destructive",
      });
      
      next();
    } finally {
      setIsEnhancing(false);
    }
  };

  const next = () => setStep((prev) => Math.min(5, prev + 1) as StepId);
  const back = () => setStep((prev) => Math.max(1, prev - 1) as StepId);

  const handleStrategyContinue = () => {
    setAgentName(currentStrategy.title);
    setAgentGoal(
      `You are a ${currentStrategy.title.toLowerCase()} for ${currentIndustry.title.toLowerCase()}. ${currentStrategy.description} Keep responses clear, helpful, and short.`,
    );
    next();
  };

  const handleFinish = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      // 1. Create the system prompt by combining greeting and goal
      const systemPrompt = `Welcome Greeting: ${welcomeGreeting}\n\n${agentGoal}`;

      // 2. Insert the agent into Supabase
      const payload = {
        name: agentName,
        system_prompt: systemPrompt,
        voice: voice || "terrence",
        temperature,
        first_speaker: firstSpeaker,
        language_hint: language,
        max_duration: maxDuration,
        user_id: user.id,
        ai_provider: aiProvider,
        model: model,
        is_active: true,
      };

      const { data: newAgent, error: insertError } = await supabase
        .from("agents")
        .insert(payload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      // 3. Sync with Ultravox backend
      if (newAgent) {
        await supabase.functions.invoke("sync-ultravox-agent", {
          body: { agent_id: newAgent.id },
        });
      }

      // 4. Mark onboarding complete in DB (fire in background — don't block navigation)
      sessionStorage.removeItem(ONBOARDING_FLAG_KEY);
      completeOnboarding().catch(console.warn);

      toast({
        title: "Success!",
        description: "Your AI agent has been created and your dashboard is ready.",
      });

      // 5. Navigate immediately. Pass state flag so ProtectedRoute skips
      //    the needsOnboarding check while the profile re-fetch settles.
      navigate("/dashboard", { replace: true, state: { onboardingJustCompleted: true } });
    } catch (error: any) {
      console.error("Onboarding finish error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create agent. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-6 py-10 flex flex-col">
      <div className="mx-auto w-full px-4 md:px-12 lg:px-28 flex flex-col flex-1">
        {step > 1 && (
          <div className="mb-24">
            <StepHeader step={step} />
          </div>
        )}

        <div className="flex-1 flex items-center justify-center w-full">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="flex w-full flex-col items-center justify-center gap-8 text-center"
              >
              <div className="flex flex-col items-center gap-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-transparent">
                  <img src="/logo.png" alt="MagicTeams" className="h-20 w-20 object-contain" />
                </div>
                <div className="rounded-full border border-muted-foreground/20 px-5 py-2 text-base font-medium bg-muted/30">
                  AI-Powered Voice Agents
                </div>
              </div>
              <div className="space-y-4">
                <h1 className="text-5xl font-bold tracking-tight text-foreground md:text-6xl text-balance">
                  Welcome to MagicTeams
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground md:text-xl text-balance">
                  Create your first Voice AI agent in minutes. No coding required.
                  <br className="hidden md:block" />
                  Just answer a few questions and let AI do the rest.
                </p>
              </div>
              <Button
                type="button"
                className="h-10 rounded-full px-8 text-base shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-95 bg-primary text-primary-foreground"
                onClick={next}
              >
                Create Voice AI Agent
              </Button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full max-w-[1400px] space-y-10 mx-auto"
            >
              <div className="space-y-2 text-center">
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Select Your Industry</h1>
                <p className="text-lg text-muted-foreground">
                  Choose the industry that best fits your use case
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3 pt-6">
                {INDUSTRIES.map((item) => {
                  const selected = item.id === industry;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setIndustry(item.id)}
                      className={[
                        "rounded-2xl border p-4 text-left transition-all hover:border-primary/40",
                        selected
                          ? "border-primary shadow-[0_0_0_2px_rgba(139,92,246,0.1)] bg-primary/5"
                          : "border-border bg-card",
                      ].join(" ")}
                    >
                      <div className="mb-1 text-lg font-semibold">{item.title}</div>
                      <div className="text-sm text-muted-foreground">{item.description}</div>
                    </button>
                  );
                })}
              </div>

              {industry === "other" && (
                <div className="flex justify-center pt-8">
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-md space-y-3"
                  >
                    <Label htmlFor="custom-industry" className="text-lg font-semibold text-center block">Please specify your industry</Label>
                    <Input 
                      id="custom-industry"
                      placeholder="e.g. Legal, Hospitality, Fitness..."
                      value={customIndustry}
                      onChange={(e) => setCustomIndustry(e.target.value)}
                      className="h-12 rounded-xl text-lg focus:ring-primary/20 transition-all border-primary/20"
                    />
                  </motion.div>
                </div>
              )}

              <div className="flex justify-center">
                <Button 
                  className="h-12 rounded-full px-12 text-lg font-semibold shadow-lg shadow-primary/25 bg-primary text-primary-foreground hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-95 disabled:opacity-50" 
                  onClick={next}
                  disabled={industry === "other" && !customIndustry.trim()}
                >
                  Continue
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full max-w-[1400px] space-y-10 mx-auto"
            >
              <div className="space-y-2 text-center">
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Choose a Template</h1>
                <p className="text-lg text-muted-foreground">
                  Select a pre-built template or start from scratch
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3 pt-6">
                {availableStrategies.map((item) => {
                  const selected = item.id === strategy;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStrategy(item.id)}
                      className={[
                        "rounded-2xl border p-4 text-left transition-all hover:border-primary/40",
                        selected
                          ? "border-primary shadow-[0_0_0_2px_rgba(139,92,246,0.1)] bg-primary/5"
                          : "border-border bg-card",
                      ].join(" ")}
                    >
                      <div className="mb-1 text-lg font-semibold">{item.title}</div>
                      <div className="text-sm text-muted-foreground">{item.description}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-center">
                <Button className="h-10 rounded-full px-10 text-base shadow-lg shadow-primary/25 bg-primary text-primary-foreground hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-95" onClick={handleStrategyContinue}>
                  Continue to Setup
                </Button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full max-w-[1400px] space-y-10 mx-auto"
            >
              <div className="space-y-2 text-center">
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Configure Your Prompt</h1>
                <p className="text-lg text-muted-foreground">
                  {!modeSelected ? "How would you like to create your AI agent?" : "Tell us about your agent's personality"}
                </p>
              </div>

              {!modeSelected ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {TEMPLATE_MODES.map((item) => {
                    const selected = item.id === templateMode;
                    const Icon = item.id === "generate" ? Sparkles : FileText;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setTemplateMode(item.id);
                          setModeSelected(true);
                        }}
                        className={[
                          "rounded-2xl border p-5 text-left transition-all hover:border-primary/40 group",
                          selected
                            ? "border-primary shadow-[0_0_0_2px_rgba(139,92,246,0.1)] bg-primary/5"
                            : "border-border bg-card",
                        ].join(" ")}
                      >
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="mb-1 text-lg font-semibold">{item.title}</div>
                        <div className="text-sm text-muted-foreground">{item.description}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center justify-between p-4 rounded-xl border bg-muted/30">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {templateMode === "generate" ? <Sparkles className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="font-semibold">{templateMode === "generate" ? "AI-Enhanced Prompt" : "Manual Prompt Entry"}</div>
                        <div className="text-sm text-muted-foreground">Describe what you want your agent to do</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => setModeSelected(false)}
                      className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Change mode
                    </button>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-lg font-bold">Describe your agent</Label>
                    <div className="relative">
                      <Textarea 
                        placeholder={templateMode === "generate" ? "e.g., \"I want a friendly customer support agent that helps users with product questions and issues...\"" : "Paste your full system prompt here..."}
                        className="min-h-[160px] resize-none rounded-xl border-2 focus-visible:ring-primary/20 text-base p-4"
                        value={templateMode === "generate" ? promptDescription : agentGoal}
                        onChange={(e) => templateMode === "generate" ? setPromptDescription(e.target.value) : setAgentGoal(e.target.value)}
                        disabled={isEnhancing}
                      />
                      
                      {isEnhancing && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                              <RefreshCw className="h-10 w-10 animate-spin text-primary opacity-20" />
                              <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-primary animate-pulse" />
                            </div>
                            <div className="text-center">
                              <div className="font-bold text-lg">Gemini is thinking...</div>
                              <div className="text-sm text-muted-foreground">Writing your professional persona</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Tip: Be specific about the tone, responsibilities, and behavior you want
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-center pt-4">
                <Button 
                  className={[
                    "h-12 rounded-full px-12 text-lg font-semibold shadow-lg transition-all active:scale-95 bg-primary text-primary-foreground",
                    (!modeSelected || isEnhancing || (templateMode === "generate" ? !promptDescription.trim() : !agentGoal.trim())) ? "opacity-50 pointer-events-none" : "shadow-primary/25 hover:shadow-xl hover:shadow-primary/30"
                  ].join(" ")}
                  onClick={handleEnhanceAndContinue}
                  disabled={isEnhancing}
                >
                  {isEnhancing ? "Enhancing Persona..." : (templateMode === "generate" ? "Enhance & Continue" : "Save & Continue")}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="step-5"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="w-full max-w-[1400px] space-y-8 mx-auto"
            >
              <div className="space-y-2 text-center">
                <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Configure Your Agent</h1>
                <p className="text-lg text-muted-foreground">
                  Customize the voice, personality, and behavior
                </p>
              </div>

              <Card className="rounded-3xl border-border/80 shadow-sm overflow-hidden">
                <CardContent className="space-y-6 p-8">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name" className="text-lg font-semibold">
                      Agent Name
                    </Label>
                    <Input
                      id="agent-name"
                      value={agentName}
                      onChange={(event) => setAgentName(event.target.value)}
                      className="h-10 text-base focus-visible:ring-primary/20 transition-all font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pb-2">
                    <div className="space-y-2">
                      <Label htmlFor="ai-provider" className="text-lg font-semibold">AI Provider</Label>
                      <Select value={aiProvider} onValueChange={(val) => {
                        setAiProvider(val);
                        if (val === "sarvam") {
                          setModel("sarvam-30b");
                          setVoice("anushka");
                          setLanguage("en-IN");
                        } else {
                          setModel("fixie-ai/ultravox-v0.7");
                          setVoice("terrence");
                          setLanguage("en");
                        }
                      }}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AI_PROVIDERS.map((p) => (
                            <SelectItem key={p.value} value={p.value} disabled={p.disabled}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="model" className="text-lg font-semibold">Model</Label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {aiProvider === "sarvam" ? (
                            SARVAM_MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)
                          ) : models.length > 0 ? (
                            models.map(m => (
                              <SelectItem key={m.name} value={m.name}>
                                {m.name.replace('fixie-ai/', '').replace('ultravox-', 'MagicTeams ')}
                              </SelectItem>
                            ))
                          ) : <SelectItem value="fixie-ai/ultravox-v0.7">MagicTeams v0.7</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="voice" className="text-lg font-semibold">Select Voice</Label>
                      <Select value={voice} onValueChange={setVoice}>
                        <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          {aiProvider === "sarvam" ? (
                             SARVAM_VOICES.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)
                          ) : loadingVoices ? (
                             <div className="flex items-center justify-center p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                          ) : voices.length > 0 ? (
                             voices.map(v => <SelectItem key={v.voiceId} value={v.name}>{v.name} {v.languageLabel || ""}</SelectItem>)
                          ) : VOICES.map(v => <SelectItem key={v.toLowerCase()} value={v.toLowerCase()}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="language" className="text-lg font-semibold">Language</Label>
                      {aiProvider === "sarvam" ? (
                        <Select value={language} onValueChange={setLanguage}>
                          <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {SARVAM_LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={language} onChange={e => setLanguage(e.target.value)} placeholder="en" className="h-10 rounded-xl" />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="first-speaker" className="text-lg font-semibold">
                        First Speaker
                      </Label>
                      <Select value={firstSpeaker} onValueChange={setFirstSpeaker}>
                        <SelectTrigger className="h-10 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FIRST_SPEAKER_AGENT">Agent speaks first</SelectItem>
                          <SelectItem value="FIRST_SPEAKER_USER">User speaks first</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="max-duration" className="text-lg font-semibold">
                        Max Duration (sec)
                      </Label>
                      <Input
                        id="max-duration"
                        type="number"
                        value={maxDuration}
                        onChange={(e) => setMaxDuration(parseInt(e.target.value) || 300)}
                        className="h-10 rounded-xl text-base"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <Label className="text-lg font-semibold">Temperature</Label>
                      <span className="text-sm font-medium text-primary">{temperature}</span>
                    </div>
                    <Slider
                      value={[temperature]}
                      onValueChange={([val]) => setTemperature(val)}
                      min={0}
                      max={1}
                      step={0.1}
                      className="py-4"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground italic">
                      <span>Focused & Direct</span>
                      <span>Creative & Random</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="greeting" className="text-lg font-semibold">
                      Welcome Greeting (Optional)
                    </Label>
                    <Textarea
                      id="greeting"
                      value={welcomeGreeting}
                      onChange={(event) => setWelcomeGreeting(event.target.value)}
                      className="min-h-24 text-base focus-visible:ring-primary/20 transition-all font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="goal" className="text-lg font-semibold">
                      Agent Goal & Personality
                    </Label>
                    <Textarea
                      id="goal"
                      value={agentGoal}
                      onChange={(event) => setAgentGoal(event.target.value)}
                      className="min-h-32 text-base focus-visible:ring-primary/20 transition-all font-medium"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-center gap-8">
                <Button variant="ghost" className="h-10 px-6 text-base hover:bg-primary/5 transition-all" onClick={back} disabled={submitting}>
                  Back
                </Button>
                <Button
                  className="h-10 rounded-full px-12 text-base shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-95 bg-primary text-primary-foreground"
                  onClick={handleFinish}
                  disabled={submitting || !agentName.trim()}
                >
                  {submitting ? "Creating..." : "Create Agent"}
                </Button>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
