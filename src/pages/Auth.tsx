import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Phone, Bot, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  if (user) {
    navigate("/dashboard");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signIn(email, password);
        navigate("/dashboard");
      } else {
        await signUp(email, password, fullName);
        toast({
          title: "Account created!",
          description: "Check your email to confirm your account.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left side - branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-primary p-12 text-primary-foreground">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/20">
              <Phone className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight">ReceptoAI</span>
          </div>
        </div>
        <div className="space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Your AI-Powered<br />Phone Receptionist
          </h1>
          <p className="text-lg text-primary-foreground/80 max-w-md">
            Never miss a call again. Set up intelligent AI receptionists that handle 
            calls, answer questions, and delight your customers 24/7.
          </p>
          <div className="flex gap-6 pt-4">
            <div className="flex items-center gap-2 text-sm text-primary-foreground/70">
              <Bot className="h-4 w-4" />
              <span>Custom AI Agents</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-primary-foreground/70">
              <Sparkles className="h-4 w-4" />
              <span>Knowledge Base</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-primary-foreground/70">
              <Phone className="h-4 w-4" />
              <span>Twilio Integration</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-primary-foreground/50">
          Powered by Ultravox AI
        </p>
      </div>

      {/* Right side - form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <Card className="w-full max-w-md border-0 shadow-none lg:border lg:shadow-sm">
          <CardHeader className="space-y-1 text-center">
            <div className="flex items-center justify-center gap-2 lg:hidden mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <Phone className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold">ReceptoAI</span>
            </div>
            <CardTitle className="text-2xl font-bold">
              {isLogin ? "Welcome back" : "Create an account"}
            </CardTitle>
            <CardDescription>
              {isLogin
                ? "Sign in to manage your AI receptionists"
                : "Get started with your AI phone receptionist"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required={!isLogin}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm text-muted-foreground">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="font-medium text-primary hover:underline"
              >
                {isLogin ? "Sign up" : "Sign in"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
