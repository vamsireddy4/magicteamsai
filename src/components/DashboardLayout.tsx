import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Bot,
  Phone,
  BookOpen,
  History,
  Settings,
  LogOut,
  Menu,
  X,
  PhoneCall,
  MonitorSmartphone,
  Megaphone,
  Webhook,
  Wrench,
  Calendar,
  PanelLeftClose,
  PanelLeftOpen,
  HelpCircle,
  CreditCard,
  Shield,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAIL } from "@/lib/constants";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/outbound-call", label: "Outbound Call", icon: PhoneCall },
  { href: "/demo-call", label: "Demo Call", icon: MonitorSmartphone },
  { href: "/phone-config", label: "Phone Integration", icon: Phone },
  { href: "/call-logs", label: "Call History", icon: History },
  { href: "/calendar-integrations", label: "Calendars", icon: Calendar },
  { href: "/pricing", label: "Pricing", icon: CreditCard },
  { href: "/support", label: "Support", icon: HelpCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [availableSeconds, setAvailableSeconds] = useState<number | null>(null);
  const location = useLocation();
  const { signOut, user } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!user) {
      setAvailableSeconds(null);
      return;
    }

    supabase
      .from("user_minute_balances")
      .select("available_seconds")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvailableSeconds(data?.available_seconds ?? 0));
  }, [user, location.pathname]);

  const minuteLabel = isAdmin
    ? "Unlimited"
    : availableSeconds == null
      ? null
      : availableSeconds >= 60
        ? `${Math.floor(availableSeconds / 60)} min`
        : `${availableSeconds}s`;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-card transition-all duration-200 lg:static lg:translate-x-0",
          collapsed ? "w-16" : "w-64",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className={cn("flex h-16 items-center border-b border-border", collapsed ? "justify-center px-2" : "justify-between px-6")}>
          {collapsed ? (
            <button
              onClick={() => {
                setCollapsed(false);
                setLogoHovered(false);
              }}
              onMouseEnter={() => setLogoHovered(true)}
              onMouseLeave={() => setLogoHovered(false)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-transparent transition-all"
            >
              {logoHovered ? (
                <PanelLeftOpen className="h-5 w-5 text-muted-foreground" />
              ) : (
                <img src="/logo.png" alt="MagicTeams" className="h-8 w-8 object-contain" />
              )}
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <Link to="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-transparent">
                    <img src="/logo.png" alt="MagicTeams" className="h-9 w-9 object-contain" />
                  </div>
                  <span className="text-lg font-bold tracking-tight truncate">MagicTeams</span>
                </Link>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setCollapsed(true);
                    setLogoHovered(false);
                  }}
                  className="hidden lg:flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
                <button onClick={() => setSidebarOpen(false)} className="lg:hidden">
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            const linkContent = (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return linkContent;
          })}
        </nav>

        <div className="border-t border-border p-2 space-y-1">
          {isAdmin ? (
            collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    to="/admin-dashboard"
                    className={cn(
                      "flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium transition-colors",
                      location.pathname === "/admin-dashboard"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Shield className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Admin Dashboard</TooltipContent>
              </Tooltip>
            ) : (
              <Link
                to="/admin-dashboard"
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  location.pathname === "/admin-dashboard"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Shield className="h-4 w-4" />
                Admin Dashboard
              </Link>
            )
          ) : null}
          {minuteLabel ? (
            collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <div className="flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium text-muted-foreground">
                    <Timer className="h-4 w-4" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>{minuteLabel} left</TooltipContent>
              </Tooltip>
            ) : (
              <div className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Timer className="h-4 w-4 text-primary" />
                  <span>Minutes Left</span>
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">{minuteLabel}</div>
              </div>
            )
          ) : null}
          {collapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={signOut}
                  className="flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Sign Out</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={signOut}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          )}

        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex h-16 items-center gap-4 border-b border-border bg-card px-6 lg:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent">
              <img src="/logo.png" alt="MagicTeams" className="h-7 w-7 object-contain" />
            </div>
            <span className="font-bold">MagicTeams</span>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 18, scale: 0.992 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.992 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
