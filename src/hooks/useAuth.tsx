import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  needsOnboarding: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Session-level flag: once completeOnboarding() is called, this permanently
  // flips to true for the lifetime of the React tree (until page refresh).
  // This ensures ALL protected routes see needsOnboarding=false immediately,
  // not just the dashboard, without waiting for DB/profile re-fetch to settle.
  const [sessionOnboardingDone, setSessionOnboardingDone] = useState(false);

  const fetchProfile = async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", nextUser.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    setProfile(data ?? null);
  };

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isMounted) return;

        const nextUser = nextSession?.user ?? null;
        setSession(nextSession);
        setUser(nextUser);

        Promise.resolve(fetchProfile(nextUser))
          .catch(() => {
            if (isMounted) {
              setProfile(null);
            }
          })
          .finally(() => {
            if (isMounted) {
              setLoading(false);
            }
          });
      }
    );

    supabase.auth.getSession().then(async ({ data: { session: nextSession } }) => {
      if (!isMounted) return;

      const nextUser = nextSession?.user ?? null;

      // Prevent stale null getSession responses from overriding a fresh OAuth session
      setSession((current) => current ?? nextSession);
      setUser((current) => current ?? nextUser);

      try {
        await fetchProfile(nextUser);
      } catch {
        if (isMounted) {
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/auth`,
      },
    });
    if (error) throw error;
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth`,
      },
    });
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const refreshProfile = async () => {
    await fetchProfile(user);
  };

  const completeOnboarding = async () => {
    if (!user) {
      return;
    }

    // Immediately flip session flag — this makes needsOnboarding=false RIGHT NOW
    // for every protected route in the app, without waiting for DB or re-fetch.
    setSessionOnboardingDone(true);

    // Optimistically update profile in memory too
    setProfile((prev) => prev ? { ...prev, onboarding_completed: true } : prev);

    try {
      // Use upsert so it works even if the profile row doesn't exist yet
      const { error } = await supabase
        .from("profiles")
        .upsert(
          { user_id: user.id, onboarding_completed: true },
          { onConflict: "user_id" }
        );

      if (error) {
        console.warn("Could not update onboarding status:", error.message);
      }
    } catch (e) {
      console.warn("Error completing onboarding:", e);
    }

    // Sync fresh profile from DB in background
    fetchProfile(user).catch(() => {});
  };

  // needsOnboarding: false if any of these are true:
  //   - sessionOnboardingDone (set immediately when completeOnboarding() is called)
  //   - profile exists and onboarding_completed is not false
  //   - still loading (don't redirect yet)
  const needsOnboarding = Boolean(
    !loading &&
    !sessionOnboardingDone &&
    user && (
      !profile ||
      profile.onboarding_completed === false
    )
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        needsOnboarding,
        signUp,
        signIn,
        signInWithGoogle,
        resetPassword,
        signOut,
        refreshProfile,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
