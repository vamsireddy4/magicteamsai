import { useAuth } from "@/hooks/useAuth";
import { Navigate, useLocation } from "react-router-dom";

const ONBOARDING_FLAG_KEY = "magicteams_onboarding_signup_only";

export default function ProtectedRoute({
  children,
  allowIncompleteOnboarding = false,
}: {
  children: React.ReactNode;
  allowIncompleteOnboarding?: boolean;
}) {
  const { user, loading, needsOnboarding } = useAuth();
  const location = useLocation();

  // If the user just completed onboarding, bypass the needsOnboarding check.
  // The navigate() call in Onboarding.tsx passes this state flag so we don't
  // bounce them back before the profile re-fetch completes.
  const justFinishedOnboarding = location.state?.onboardingJustCompleted === true;
  const shouldShowOnboarding = typeof window !== "undefined" && sessionStorage.getItem(ONBOARDING_FLAG_KEY) === "true";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (needsOnboarding && shouldShowOnboarding && !allowIncompleteOnboarding && !justFinishedOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
