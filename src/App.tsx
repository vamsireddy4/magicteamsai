import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import AgentForm from "./pages/AgentForm";
import KnowledgeBase from "./pages/KnowledgeBase";
import PhoneConfig from "./pages/PhoneConfig";
import CallLogs from "./pages/CallLogs";
import OutboundCall from "./pages/OutboundCall";
import UserSettings from "./pages/UserSettings";
import Campaigns from "./pages/Campaigns";
import Webhooks from "./pages/Webhooks";
import ScheduledCalls from "./pages/ScheduledCalls";
import CustomTools from "./pages/CustomTools";
import CalendarIntegrations from "./pages/CalendarIntegrations";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
            <Route path="/agents/new" element={<ProtectedRoute><AgentForm /></ProtectedRoute>} />
            <Route path="/agents/:id" element={<ProtectedRoute><AgentForm /></ProtectedRoute>} />
            <Route path="/knowledge-base" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} />
            <Route path="/phone-config" element={<ProtectedRoute><PhoneConfig /></ProtectedRoute>} />
            <Route path="/call-logs" element={<ProtectedRoute><CallLogs /></ProtectedRoute>} />
            <Route path="/outbound-call" element={<ProtectedRoute><OutboundCall /></ProtectedRoute>} />
            <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
            <Route path="/webhooks" element={<ProtectedRoute><Webhooks /></ProtectedRoute>} />
            
            <Route path="/custom-tools" element={<ProtectedRoute><CustomTools /></ProtectedRoute>} />
            <Route path="/calendar-integrations" element={<ProtectedRoute><CalendarIntegrations /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><UserSettings /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
