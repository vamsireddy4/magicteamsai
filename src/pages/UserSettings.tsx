import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, Eye, EyeOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


const AI_NAMES: Record<string, string> = {
  gemini: "Gemini",
  perplexity: "Perplexity",
  grok: "Grok",
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  cloudflare: "Cloudflare",
  other: "Other",
};

const BUILT_IN_MODELS = ["gemini", "perplexity", "grok", "chatgpt", "deepseek", "cloudflare"] as const;
const isBuiltInModel = (value: string | null | undefined) =>
  !!value && BUILT_IN_MODELS.includes(value as (typeof BUILT_IN_MODELS)[number]);

export default function UserSettings() {

  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [profileLoading, setProfileLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [form, setForm] = useState({ 
    full_name: "", 
    company_name: "", 
    gemini_api_key: "",
    analysis_model: "gemini" 
  });
  const [selectedModelOption, setSelectedModelOption] = useState("gemini");
  const [customModelName, setCustomModelName] = useState("");


  // Password change state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAnalysisKey, setShowAnalysisKey] = useState(false);

  // Check if user signed in with email/password
  const isPasswordUser = user?.app_metadata?.providers?.includes("email") ?? false;

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const storedModel = data.analysis_model || "gemini";
          const builtInModel = isBuiltInModel(storedModel);
          setForm({
            full_name: data.full_name || "",
            company_name: data.company_name || "",
            gemini_api_key: data.gemini_api_key || "",
            analysis_model: storedModel,
          });
          setSelectedModelOption(builtInModel ? storedModel : "other");
          setCustomModelName(builtInModel ? "" : storedModel);

        }
      });
  }, [user]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name,
        company_name: form.company_name,
      })
      .eq("user_id", user.id);

    setProfileLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile saved" });
      await refreshProfile();
    }
  };

  const handleAnalysisSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (selectedModelOption === "other" && !customModelName.trim()) {
      toast({ title: "Error", description: "Enter a custom model name.", variant: "destructive" });
      return;
    }
    setAnalysisLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        analysis_model: selectedModelOption === "other" ? customModelName.trim() : form.analysis_model,
        gemini_api_key: form.gemini_api_key,
      })
      .eq("user_id", user.id);

    setAnalysisLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Analysis AI settings saved" });
      await refreshProfile();
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordLoading(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated successfully" });
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account settings.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={user?.email || ""} disabled />
              </div>
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input value={user?.id || ""} disabled />
                <p className="text-xs text-muted-foreground">
                  Your unique account ID.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  placeholder="Your company"
                />
              </div>
              <Button type="submit" disabled={profileLoading}>
                {profileLoading ? "Saving..." : "Save Profile"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Analysis AI</CardTitle>
            <CardDescription>
              Configure the model and API key used for call analysis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAnalysisSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={selectedModelOption}
                  onValueChange={(value) => {
                    setSelectedModelOption(value);
                    if (value !== "other") {
                      setForm({ ...form, analysis_model: value });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="perplexity">Perplexity</SelectItem>
                    <SelectItem value="grok">Grok</SelectItem>
                    <SelectItem value="chatgpt">ChatGPT</SelectItem>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose which model to use for call analysis.
                </p>
              </div>
              {selectedModelOption === "other" ? (
                <div className="space-y-2">
                  <Label>Custom Model Name</Label>
                  <Input
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    placeholder="Enter model name"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>{selectedModelOption === "other" ? (customModelName || "Custom Model") : (AI_NAMES[form.analysis_model] || "Gemini")} API Key</Label>
                <div className="relative">
                  <Input
                    type={showAnalysisKey ? "text" : "password"}
                    value={form.gemini_api_key}
                    onChange={(e) => setForm({ ...form, gemini_api_key: e.target.value })}
                    placeholder={`Enter your ${selectedModelOption === "other" ? (customModelName || "custom model") : (AI_NAMES[form.analysis_model] || "Gemini")} API Key...`}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAnalysisKey(!showAnalysisKey)}
                  >
                    {showAnalysisKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your API key is used for AI-powered prompt enhancement and call analysis.
                </p>
              </div>
              <Button type="submit" disabled={analysisLoading || (selectedModelOption === "other" && !customModelName.trim())}>
                {analysisLoading ? "Saving..." : "Save Analysis AI"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Change Password
            </CardTitle>
            <CardDescription>
              {isPasswordUser
                ? "Update your account password."
                : "Set a password to enable email/password login alongside Google sign-in."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNew(!showNew)}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowConfirm(!showConfirm)}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" disabled={passwordLoading}>
                {passwordLoading ? "Updating..." : isPasswordUser ? "Update Password" : "Set Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
