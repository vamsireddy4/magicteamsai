import * as React from "react";
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Megaphone, FileSpreadsheet, ClipboardList, RefreshCw } from "lucide-react";
import CampaignsTab from "@/components/campaigns/CampaignsTab";
import DataCleaningTab from "@/components/campaigns/DataCleaningTab";
import OutcomesTab from "@/components/campaigns/OutcomesTab";
import RetryCSVTab from "@/components/campaigns/RetryCSVTab";

export default function Campaigns() {
  const [activeTab, setActiveTab] = useState("campaigns");

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1">Manage campaigns, clean data, track outcomes, and generate retries.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="campaigns" className="flex items-center gap-2">
              <Megaphone className="h-4 w-4" /> Campaigns
            </TabsTrigger>
            <TabsTrigger value="data-cleaning" className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Data Cleaning
            </TabsTrigger>
            <TabsTrigger value="outcomes" className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Outcomes
            </TabsTrigger>
            <TabsTrigger value="retry-csv" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Retry CSV
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
          <TabsContent value="data-cleaning"><DataCleaningTab /></TabsContent>
          <TabsContent value="outcomes"><OutcomesTab /></TabsContent>
          <TabsContent value="retry-csv"><RetryCSVTab /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
