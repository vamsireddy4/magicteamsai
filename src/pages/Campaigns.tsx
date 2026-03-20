import * as React from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Megaphone, FileSpreadsheet, ClipboardList, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import CampaignsTab from "@/components/campaigns/CampaignsTab";
import DataCleaningTab from "@/components/campaigns/DataCleaningTab";
import OutcomesTab from "@/components/campaigns/OutcomesTab";
import RetryCSVTab from "@/components/campaigns/RetryCSVTab";
import { usePersistentState } from "@/hooks/usePersistentState";

export default function Campaigns() {
  const [activeTab, setActiveTab] = usePersistentState("campaigns-page-active-tab", "data-cleaning");
  const tabs = [
    { value: "data-cleaning", label: "Data Cleaning", icon: FileSpreadsheet },
    { value: "campaigns", label: "Campaigns", icon: Megaphone },
    { value: "outcomes", label: "Outcomes", icon: ClipboardList },
    { value: "retry-csv", label: "Retry CSV", icon: RefreshCw },
  ] as const;
  const activeIndex = Math.max(tabs.findIndex((tab) => tab.value === activeTab), 0);

  const renderActiveTab = () => {
    switch (activeTab) {
      case "campaigns":
        return <CampaignsTab />;
      case "outcomes":
        return <OutcomesTab />;
      case "retry-csv":
        return <RetryCSVTab />;
      case "data-cleaning":
      default:
        return <DataCleaningTab />;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1">Manage campaigns, clean data, track outcomes, and generate retries.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="relative grid w-full grid-cols-4 overflow-hidden rounded-xl border border-border/50 bg-muted/60 p-1">
            <motion.div
              className="absolute inset-y-1 rounded-lg bg-background shadow-sm"
              animate={{
                width: "calc(25% - 6px)",
                x: `calc(${activeIndex * 100}% + 4px)`,
              }}
              transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.85 }}
            />
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="relative z-10 flex items-center gap-2 rounded-lg bg-transparent transition-colors duration-300 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <Icon className="h-4 w-4" /> {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value={activeTab} forceMount className="relative overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.985 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                {renderActiveTab()}
              </motion.div>
            </AnimatePresence>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
