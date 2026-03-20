import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePersistentState } from "@/hooks/usePersistentState";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Phone, Target, MoreVertical, Pencil, Trash2, Play, Loader2, Users, CalendarDays, Clock, Hash, FileText, ArrowLeft, Bot, Check, ChevronsUpDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string;
  venue_name: string;
  venue_location: string | null;
  start_date: string | null;
  end_date: string | null;
  times: string | null;
  age_range: string | null;
  round: number;
  status: string;
  booking_target: number | null;
  twilio_phone_number: string | null;
  elevenlabs_campaign_id: string | null;
  notes: string | null;
  created_at: string;
  phone_config_id: string | null;
  agent_id: string | null;
  delay_seconds: number;
  enable_number_locking: boolean;
  calls_made: number;
  total_contacts: number;
}

interface AgentRow { id: string; name: string; }
interface PhoneConfigRow { id: string; phone_number: string; friendly_name: string | null; provider: string; }
interface CampaignCallLog {
  id: string;
  recipient_number: string | null;
  caller_number?: string | null;
  status: string;
  duration: number | null;
  started_at: string | null;
  summary: string | null;
  ended_at: string | null;
  transcript: any;
  ultravox_call_id: string | null;
}

interface MultiPhoneSelectProps {
  label: string;
  value: string[];
  options: PhoneConfigRow[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  helperText?: string;
}

const upsertCampaignOutcome = async (
  campaignId: string,
  contact: any,
  outcome: string,
  attemptNumber: number,
  userId: string,
) => {
  const { data: existing, error: existingError } = await supabase
    .from("call_outcomes")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("contact_id", contact.id || null)
    .eq("attempt_number", attemptNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const payload = {
    user_id: userId,
    campaign_id: campaignId,
    phone_number: contact.phone_number,
    parent_name: contact.first_name || null,
    child_names: contact.child_names || null,
    venue_name: contact.venue_name || null,
    contact_id: contact.id || null,
    outcome,
    attempt_number: attemptNumber,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from("call_outcomes")
      .update(payload)
      .eq("id", existing.id);
    if (error) {
      throw new Error(error.message);
    }
    return existing.id;
  }

  const { data, error } = await supabase
    .from("call_outcomes")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data.id;
};

const getInvokeErrorMessage = async (err: any) => {
  if (!err) return "Unknown error";
  const context = err.context;
  if (context instanceof Response) {
    const payload = await context.clone().json().catch(async () => ({ error: await context.text().catch(() => "") }));
    return payload?.error || payload?.details || err.message || "Function call failed";
  }
  return err.message || "Function call failed";
};

const shouldFallbackToLocalCampaign = (err: any) => {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("cors") ||
    message.includes("failed to fetch") ||
    message.includes("non-2xx") ||
    message.includes("typeerror: failed to fetch") ||
    message.includes("networkerror")
  );
};

const normalizeCampaignPhoneNumber = (raw: string, fromNumber?: string | null) => {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;
  if (digits.length >= 11) return `+${digits}`;

  const fromDigits = String(fromNumber || "").replace(/\D/g, "");
  if (digits.length === 10 && fromDigits.length >= 11) {
    const countryCode = fromDigits.slice(0, fromDigits.length - 10);
    if (countryCode) return `+${countryCode}${digits}`;
  }

  return trimmed;
};

const normalizeComparablePhone = (raw: string | null | undefined) =>
  String(raw || "").replace(/\D/g, "");

const getPhoneLabel = (phoneConfig: PhoneConfigRow) =>
  `${phoneConfig.friendly_name || phoneConfig.phone_number} (${phoneConfig.provider})`;

const togglePhoneSelection = (current: string[], phoneId: string, checked: boolean) => {
  if (checked) return current.includes(phoneId) ? current : [...current, phoneId];
  return current.filter((id) => id !== phoneId);
};

const getPhoneSelectionLabel = (selectedIds: string[], phoneConfigs: PhoneConfigRow[]) => {
  if (selectedIds.length === 0) return "Select phone numbers";
  if (selectedIds.length === 1) {
    const selectedConfig = phoneConfigs.find((phoneConfig) => phoneConfig.id === selectedIds[0]);
    return selectedConfig ? getPhoneLabel(selectedConfig) : "1 phone selected";
  }
  return `${selectedIds.length} phone numbers selected`;
};

function MultiPhoneSelect({ label, value, options, onChange, helperText }: MultiPhoneSelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{getPhoneSelectionLabel(value, options)}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search phone number..." />
            <CommandList>
              <CommandEmpty>No phone numbers found.</CommandEmpty>
              <CommandGroup>
                {options.map((phoneConfig) => {
                  const isSelected = value.includes(phoneConfig.id);
                  return (
                    <CommandItem
                      key={phoneConfig.id}
                      value={`${phoneConfig.phone_number} ${phoneConfig.friendly_name || ""} ${phoneConfig.provider}`}
                      onSelect={() => onChange((prev) => togglePhoneSelection(prev, phoneConfig.id, !isSelected))}
                    >
                      <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{phoneConfig.friendly_name || phoneConfig.phone_number}</span>
                        <span className="text-xs text-muted-foreground">
                          {phoneConfig.phone_number} · {phoneConfig.provider}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  completed: "bg-primary/10 text-primary",
};

const emptyForm = {
  venue_name: "", venue_location: "", start_date: "", end_date: "", times: "", age_range: "",
  round: 1, status: "draft", booking_target: "", twilio_phone_number: "", elevenlabs_campaign_id: "",
  notes: "", agent_id: "", phone_config_id: "", delay_seconds: "30", enable_number_locking: true,
};

const ACTIVE_CALL_STATUSES = ["queued", "initiated", "ringing", "in-progress"];
const ACTIVE_CALL_LOCK_WINDOW_MS = 10 * 60 * 1000;
const isLocalDevHost = () =>
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export default function CampaignsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [phoneConfigs, setPhoneConfigs] = useState<PhoneConfigRow[]>([]);
  const [campaignPhoneMap, setCampaignPhoneMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = usePersistentState("campaigns-tab-dialog-open", false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = usePersistentState("campaigns-tab-form", emptyForm);
  const [filter, setFilter] = usePersistentState("campaigns-tab-filter", "all");
  const [runningCampaign, setRunningCampaign] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = usePersistentState<string | null>("campaigns-tab-selected-campaign-id", null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [contactCount, setContactCount] = useState(0);
  const [outcomeCounts, setOutcomeCounts] = useState<Record<string, number>>({});
  const [contacts, setContacts] = useState<any[]>([]);
  const [callOutcomes, setCallOutcomes] = useState<any[]>([]);
  const [campaignCallLogs, setCampaignCallLogs] = useState<CampaignCallLog[]>([]);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [contactForm, setContactForm] = useState<Record<string, string>>({});
  const [contactMetadataForm, setContactMetadataForm] = useState<Record<string, string>>({});
  const [savingContact, setSavingContact] = useState(false);
  // Contact selection for calling
  const [selectedContactIdsState, setSelectedContactIdsState] = usePersistentState<string[]>("campaigns-tab-selected-contact-ids", []);
  const selectedContactIds = React.useMemo(() => new Set(selectedContactIdsState), [selectedContactIdsState]);
  const [detailAgent, setDetailAgent] = usePersistentState("campaigns-tab-detail-agent", "");
  const [detailPhoneIds, setDetailPhoneIds] = usePersistentState<string[]>("campaigns-tab-detail-phone-ids", []);
  const [detailDelay, setDetailDelay] = usePersistentState("campaigns-tab-detail-delay", "30");
  const [detailNumberLocking, setDetailNumberLocking] = usePersistentState("campaigns-tab-detail-locking", true);
  const [startingCall, setStartingCall] = useState(false);
  const startCampaignInFlightRef = React.useRef(false);
  const [formPhoneIds, setFormPhoneIds] = usePersistentState<string[]>("campaigns-tab-form-phone-ids", []);

  const getCampaignPhoneIds = React.useCallback((campaign: Campaign) => {
    const linkedIds = campaignPhoneMap[campaign.id] || [];
    if (linkedIds.length > 0) return linkedIds;
    return campaign.phone_config_id ? [campaign.phone_config_id] : [];
  }, [campaignPhoneMap]);

  const syncCampaignPhoneConfigs = async (campaignId: string, phoneIds: string[]) => {
    if (!user) return;

    await supabase.from("campaign_phone_configs").delete().eq("campaign_id", campaignId);
    if (phoneIds.length === 0) return;

    const rows = phoneIds.map((phoneId, index) => ({
      user_id: user.id,
      campaign_id: campaignId,
      phone_config_id: phoneId,
      sort_order: index,
    }));

    const { error } = await supabase.from("campaign_phone_configs").insert(rows as any);
    if (error) throw error;
  };

  const getAvailablePhoneConfig = async (
    availablePhoneConfigs: PhoneConfigRow[],
    startIndex: number,
    enableNumberLocking: boolean,
  ) => {
    if (availablePhoneConfigs.length === 0 || !user) {
      return { phoneConfig: null as PhoneConfigRow | null, nextIndex: startIndex };
    }

    if (!enableNumberLocking) {
      const phoneConfig = availablePhoneConfigs[startIndex % availablePhoneConfigs.length];
      return { phoneConfig, nextIndex: (startIndex + 1) % availablePhoneConfigs.length };
    }

    const activeSinceIso = new Date(Date.now() - ACTIVE_CALL_LOCK_WINDOW_MS).toISOString();
    const { data: activeCalls } = await supabase
      .from("call_logs")
      .select("caller_number, started_at")
      .eq("user_id", user.id)
      .in("status", ACTIVE_CALL_STATUSES)
      .is("ended_at", null)
      .gte("started_at", activeSinceIso)
      .in("caller_number", availablePhoneConfigs.map((phoneConfig) => phoneConfig.phone_number));

    const busyNumbers = new Set((activeCalls || []).map((entry: any) => entry.caller_number));
    for (let offset = 0; offset < availablePhoneConfigs.length; offset += 1) {
      const idx = (startIndex + offset) % availablePhoneConfigs.length;
      const candidate = availablePhoneConfigs[idx];
      if (!busyNumbers.has(candidate.phone_number)) {
        return { phoneConfig: candidate, nextIndex: (idx + 1) % availablePhoneConfigs.length };
      }
    }

    return { phoneConfig: null as PhoneConfigRow | null, nextIndex: startIndex };
  };

  const startCampaignLocal = async (campaign: Campaign, contactIds?: string[]) => {
    if (!user) throw new Error("User not found");

    const { data: agent, error: agentError } = await supabase.from("agents").select("*").eq("id", campaign.agent_id).single();
    if (agentError || !agent) throw new Error(agentError?.message || "Agent not found");

    const campaignPhoneIds = getCampaignPhoneIds(campaign);
    if (campaignPhoneIds.length === 0) throw new Error("No phone configs found");
    const { data: phoneConfigRows, error: phoneError } = await supabase
      .from("phone_configs")
      .select("*")
      .in("id", campaignPhoneIds);
    if (phoneError || !phoneConfigRows?.length) throw new Error(phoneError?.message || "Phone config not found");
    const phoneConfigMap = new Map(phoneConfigRows.map((row: any) => [row.id, row]));
    const orderedPhoneConfigs = campaignPhoneIds.map((id) => phoneConfigMap.get(id)).filter(Boolean) as any[];

    let selectedContacts = contacts;
    if (!selectedContacts.length || selectedCampaign?.id !== campaign.id) {
      const { data: fetchedContacts, error: contactsError } = await supabase
        .from("contacts")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("created_at");
      if (contactsError) throw new Error(contactsError.message);
      selectedContacts = fetchedContacts || [];
    }

    if (contactIds?.length) {
      const contactIdSet = new Set(contactIds);
      selectedContacts = selectedContacts.filter((contact) => contactIdSet.has(contact.id));
    }

    if (!selectedContacts.length) {
      throw new Error("No contacts found for this campaign");
    }

    await supabase.from("campaigns").update({
      status: "active",
      agent_id: campaign.agent_id,
      phone_config_id: campaignPhoneIds[0] || null,
      delay_seconds: campaign.delay_seconds,
      enable_number_locking: campaign.enable_number_locking ?? true,
      total_contacts: selectedContacts.length,
      calls_made: 0,
    }).eq("id", campaign.id);

    const delayMs = (campaign.delay_seconds || 30) * 1000;
    let initiated = 0;
    let nextPhoneIndex = 0;

    for (let index = 0; index < selectedContacts.length; index += 1) {
      const contact = selectedContacts[index];
      let selection = await getAvailablePhoneConfig(
        orderedPhoneConfigs,
        nextPhoneIndex,
        campaign.enable_number_locking ?? true,
      );

      let lockWaitAttempts = 0;
      while (!selection.phoneConfig && lockWaitAttempts < 2) {
        lockWaitAttempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        selection = await getAvailablePhoneConfig(
          orderedPhoneConfigs,
          nextPhoneIndex,
          campaign.enable_number_locking ?? true,
        );
      }

      if (!selection.phoneConfig) {
        selection = {
          phoneConfig: orderedPhoneConfigs[nextPhoneIndex % orderedPhoneConfigs.length],
          nextIndex: (nextPhoneIndex + 1) % orderedPhoneConfigs.length,
        };
      }

      nextPhoneIndex = selection.nextIndex;
      const recipientNumber = normalizeCampaignPhoneNumber(contact.phone_number, selection.phoneConfig.phone_number);
      const attemptNumber = campaign.round || 1;

      await upsertCampaignOutcome(campaign.id, contact, "PENDING", attemptNumber, user.id);

      const response = await fetch("/api/local/outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent,
          phoneConfig: selection.phoneConfig,
          recipientNumber,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.details || "Failed to place campaign call");
      }

      initiated += 1;
      await supabase.from("campaigns").update({ calls_made: initiated }).eq("id", campaign.id);

      if (index < selectedContacts.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }

    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
    return { total: initiated };
  };

  const getCampaignResultFromCallLog = (callLog: CampaignCallLog) => {
    if (callLog.status === "completed" && (callLog.duration || 0) > 10) return "ANSWERED";
    if (callLog.status === "completed" && (callLog.duration || 0) <= 10) return "VOICEMAIL";
    if (["no-answer", "canceled", "busy"].includes(callLog.status)) return "NO_ANSWER";
    if (callLog.status === "failed") return "DECLINED";
    if (["initiated", "in-progress", "ringing", "queued"].includes(callLog.status)) return "PENDING";
    return String(callLog.status || "PENDING").toUpperCase();
  };

  const syncCampaignCallLogsFromUltravox = async (callLogs: CampaignCallLog[]) => {
    const ultravoxLogs = callLogs.filter(
      (log) =>
        log.ultravox_call_id &&
        (!log.transcript || log.duration == null || ["initiated", "in-progress", "ringing", "queued"].includes(log.status)),
    );
    if (ultravoxLogs.length === 0) return callLogs;

    const syncedLogs = await Promise.all(
      ultravoxLogs.map(async (log) => {
        try {
          const response = await fetch(`/api/local/ultravox-call-details?callId=${encodeURIComponent(log.ultravox_call_id!)}`);
          if (response.status === 204) return log;
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data?.unavailable) return log;

          const updateData = {
            duration: data?.duration ?? log.duration,
            started_at: data?.started_at ?? log.started_at,
            ended_at: data?.ended_at ?? log.ended_at,
            status: data?.status ?? log.status,
            summary: data?.summary ?? log.summary,
            transcript: data?.transcript ?? log.transcript,
          };

          await supabase.from("call_logs").update(updateData).eq("id", log.id);
          return { ...log, ...updateData };
        } catch {
          return log;
        }
      }),
    );

    const syncedById = new Map(syncedLogs.map((log) => [log.id, log]));
    return callLogs.map((log) => syncedById.get(log.id) || log);
  };

  const fetchData = async () => {
    if (!user) return;
    const [{ data: camps }, { data: ag }, { data: pc }, { data: campaignPhones }] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("agents").select("id, name"),
      supabase.from("phone_configs").select("id, phone_number, friendly_name, provider").eq("is_active", true),
      supabase.from("campaign_phone_configs").select("campaign_id, phone_config_id, sort_order").order("sort_order", { ascending: true }),
    ]);
    setCampaigns((camps as Campaign[]) || []);
    setAgents(ag || []);
    setPhoneConfigs((pc as PhoneConfigRow[]) || []);
    const nextCampaignPhoneMap = ((campaignPhones as any[]) || []).reduce((acc, row) => {
      acc[row.campaign_id] = acc[row.campaign_id] || [];
      acc[row.campaign_id].push(row.phone_config_id);
      return acc;
    }, {} as Record<string, string[]>);
    setCampaignPhoneMap(nextCampaignPhoneMap);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel('campaigns-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_phone_configs' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const openCampaignDetail = async (c: Campaign) => {
    setSelectedCampaign(c);
    if (!isLocalDevHost()) {
      await supabase.functions.invoke("sync-call-data").catch(() => null);
    }
    const [{ data: contactsData, count: cCount }, { data: outcomes }] = await Promise.all([
      supabase.from("contacts").select("*", { count: "exact" }).eq("campaign_id", c.id).order("created_at"),
      supabase.from("call_outcomes").select("*").eq("campaign_id", c.id).order("created_at", { ascending: false }),
    ]);
    const campaignPhoneIds = getCampaignPhoneIds(c);
    const primaryCampaignPhoneId = campaignPhoneIds[0] || c.phone_config_id;
    const campaignPhoneNumber = phoneConfigs.find((pc) => pc.id === primaryCampaignPhoneId)?.phone_number || null;
    const recipientNumbers = [...new Set(
      (contactsData || [])
        .flatMap((contact: any) => {
          const raw = String(contact.phone_number || "").trim();
          const normalized = normalizeCampaignPhoneNumber(raw, campaignPhoneNumber);
          return [raw, normalized].filter(Boolean);
        })
    )];
    let callLogsData: CampaignCallLog[] = [];
    if (recipientNumbers.length > 0) {
      const query = supabase
        .from("call_logs")
        .select("id, recipient_number, caller_number, status, duration, started_at, ended_at, summary, transcript, ultravox_call_id")
        .eq("direction", "outbound")
        .in("recipient_number", recipientNumbers)
        .order("started_at", { ascending: false });
      const narrowedQuery = c.agent_id ? query.eq("agent_id", c.agent_id) : query;
      const callerScopedQuery = campaignPhoneNumber ? narrowedQuery.eq("caller_number", campaignPhoneNumber) : narrowedQuery;
      const { data } = await callerScopedQuery;
      callLogsData = ((data as CampaignCallLog[]) || []).filter((log) => {
        const recipientDigits = normalizeComparablePhone(log.recipient_number);
        return (contactsData || []).some((contact: any) => {
          const rawDigits = normalizeComparablePhone(contact.phone_number);
          const normalizedDigits = normalizeComparablePhone(normalizeCampaignPhoneNumber(contact.phone_number, campaignPhoneNumber));
          return recipientDigits === rawDigits || recipientDigits === normalizedDigits;
        });
      });
    }
    callLogsData = await syncCampaignCallLogsFromUltravox(callLogsData);
    setContacts(contactsData || []);
    setContactCount(cCount || 0);
    setCallOutcomes(outcomes || []);
    setCampaignCallLogs(callLogsData);
    const counts: Record<string, number> = {};
    if (callLogsData.length > 0) {
      callLogsData.forEach((log) => {
        const outcome = getCampaignResultFromCallLog(log);
        counts[outcome] = (counts[outcome] || 0) + 1;
      });
    } else {
      (outcomes || []).forEach((o: any) => { counts[o.outcome] = (counts[o.outcome] || 0) + 1; });
    }
    setOutcomeCounts(counts);
    // Pre-select all contacts only when opening a different campaign.
    // While polling the same campaign, preserve the user's manual selection
    // and only drop ids that no longer exist.
    setSelectedContactIdsState((prev) => {
      const nextIds = new Set((contactsData || []).map((ct: any) => ct.id));
      const prevSet = new Set(prev);

      if (selectedCampaign?.id !== c.id || prevSet.size === 0) {
        return Array.from(nextIds);
      }

      const preserved = Array.from(prevSet).filter((id) => nextIds.has(id));
      return preserved.length > 0 ? preserved : Array.from(nextIds);
    });
    setSelectedCampaignId(c.id);
    setDetailAgent(c.agent_id || "");
    setDetailPhoneIds(campaignPhoneIds);
    setDetailDelay(String(c.delay_seconds || 30));
    setDetailNumberLocking(c.enable_number_locking ?? true);
  };

  useEffect(() => {
    if (!selectedCampaign) return;

    const interval = window.setInterval(() => {
      openCampaignDetail(selectedCampaign);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [selectedCampaign, phoneConfigs]);

  useEffect(() => {
    if (!selectedCampaignId || campaigns.length === 0 || selectedCampaign) return;
    const persistedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);
    if (persistedCampaign) {
      openCampaignDetail(persistedCampaign);
    }
  }, [campaigns, selectedCampaign, selectedCampaignId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const payload = {
      user_id: user.id, venue_name: form.venue_name, venue_location: form.venue_location || null,
      start_date: form.start_date || null, end_date: form.end_date || null, times: form.times || null,
      age_range: form.age_range || null, round: form.round, status: form.status,
      booking_target: form.booking_target ? parseInt(form.booking_target) : null,
      twilio_phone_number: form.twilio_phone_number || null, elevenlabs_campaign_id: form.elevenlabs_campaign_id || null,
      notes: form.notes || null, agent_id: form.agent_id || null, phone_config_id: formPhoneIds[0] || null,
      delay_seconds: parseInt(form.delay_seconds) || 30,
      enable_number_locking: form.enable_number_locking,
    };
    let error;
    let campaignId = editingId;
    if (editingId) {
      ({ error } = await supabase.from("campaigns").update(payload).eq("id", editingId));
    } else {
      const response = await supabase.from("campaigns").insert(payload as any).select("id").single();
      error = response.error;
      campaignId = response.data?.id || null;
    }
    if (error || !campaignId) { toast({ title: "Error", description: error?.message || "Failed to save campaign", variant: "destructive" }); }
    else {
      try {
        await syncCampaignPhoneConfigs(campaignId, formPhoneIds);
        toast({ title: editingId ? "Campaign updated" : "Campaign created" });
        setDialogOpen(false);
        setEditingId(null);
        setForm(emptyForm);
        setFormPhoneIds([]);
        fetchData();
      } catch (syncError: any) {
        toast({ title: "Error", description: syncError.message || "Failed to save campaign numbers", variant: "destructive" });
      }
    }
  };

  const editCampaign = (c: Campaign) => {
    setEditingId(c.id);
    setForm({
      venue_name: c.venue_name, venue_location: c.venue_location || "", start_date: c.start_date || "",
      end_date: c.end_date || "", times: c.times || "", age_range: c.age_range || "", round: c.round,
      status: c.status, booking_target: c.booking_target?.toString() || "", twilio_phone_number: c.twilio_phone_number || "",
      elevenlabs_campaign_id: c.elevenlabs_campaign_id || "", notes: c.notes || "", agent_id: c.agent_id || "",
      phone_config_id: c.phone_config_id || "", delay_seconds: c.delay_seconds?.toString() || "30",
      enable_number_locking: c.enable_number_locking ?? true,
    });
    setFormPhoneIds(getCampaignPhoneIds(c));
    setDialogOpen(true);
  };

  const deleteCampaign = async (id: string) => {
    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Campaign deleted" });
      if (selectedCampaign?.id === id) {
        setSelectedCampaign(null);
        setSelectedCampaignId(null);
      }
      fetchData();
    }
  };

  const startCampaign = async (campaignId: string) => {
    if (startCampaignInFlightRef.current) return;
    startCampaignInFlightRef.current = true;
    setRunningCampaign(campaignId);
    try {
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        const campaign = campaigns.find((item) => item.id === campaignId);
        if (!campaign) throw new Error("Campaign not found");
        const result = await startCampaignLocal(campaign);
        toast({ title: "Campaign started", description: `${result.total || 0} calls queued locally` });
        fetchData();
        return;
      }

      const { data, error } = await supabase.functions.invoke("run-campaign", { body: { campaign_id: campaignId } });
      if (error) throw error;
      toast({ title: "Campaign started", description: `${data?.total || 0} calls queued` });
      fetchData();
    } catch (err: any) {
      if (shouldFallbackToLocalCampaign(err)) {
        const campaign = campaigns.find((item) => item.id === campaignId);
        if (!campaign) {
          toast({ title: "Error", description: "Campaign not found", variant: "destructive" });
        } else {
          try {
            const result = await startCampaignLocal(campaign);
            toast({ title: "Campaign started", description: `${result.total || 0} calls queued locally` });
            fetchData();
          } catch (localErr: any) {
            toast({ title: "Error", description: localErr.message || "Failed to start local campaign", variant: "destructive" });
          }
        }
      } else {
        toast({ title: "Error", description: await getInvokeErrorMessage(err), variant: "destructive" });
      }
    } finally {
      setRunningCampaign(null);
      startCampaignInFlightRef.current = false;
    }
  };

  const startSelectedCalls = async () => {
    if (startCampaignInFlightRef.current) return;
    if (!selectedCampaign || !user) return;
    if (!detailAgent || detailPhoneIds.length === 0) { toast({ title: "Select agent and at least one phone number", variant: "destructive" }); return; }
    if (selectedContactIds.size === 0) { toast({ title: "No contacts selected", variant: "destructive" }); return; }
    startCampaignInFlightRef.current = true;
    setStartingCall(true);
    try {
      // Update campaign with agent/phone if changed
      await supabase.from("campaigns").update({
        agent_id: detailAgent, phone_config_id: detailPhoneIds[0] || null,
        delay_seconds: parseInt(detailDelay) || 30,
        enable_number_locking: detailNumberLocking,
      }).eq("id", selectedCampaign.id);
      await syncCampaignPhoneConfigs(selectedCampaign.id, detailPhoneIds);

      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        const localCampaign = {
          ...selectedCampaign,
          agent_id: detailAgent,
          phone_config_id: detailPhoneIds[0] || null,
          delay_seconds: parseInt(detailDelay) || 30,
          enable_number_locking: detailNumberLocking,
        } as Campaign;
        const result = await startCampaignLocal(localCampaign, Array.from(selectedContactIds));
        toast({ title: "Campaign started", description: `${result.total || 0} calls queued locally` });
        openCampaignDetail(localCampaign);
        fetchData();
        return;
      }

      // Pass selected contact IDs so only those are called
      const { data, error } = await supabase.functions.invoke("run-campaign", {
        body: { campaign_id: selectedCampaign.id, contact_ids: Array.from(selectedContactIds) },
      });
      if (error) throw error;
      toast({ title: "Campaign started", description: `${data?.total || 0} calls queued` });
      // Refresh detail
      const updated = {
        ...selectedCampaign,
        agent_id: detailAgent,
        phone_config_id: detailPhoneIds[0] || null,
        delay_seconds: parseInt(detailDelay) || 30,
        enable_number_locking: detailNumberLocking,
      };
      const updatedPhones = detailPhoneIds;
      setCampaignPhoneMap((prev) => ({ ...prev, [selectedCampaign.id]: updatedPhones }));
      openCampaignDetail(updated as Campaign);
      fetchData();
    } catch (err: any) {
      if (shouldFallbackToLocalCampaign(err)) {
        try {
          const localCampaign = {
            ...selectedCampaign,
            agent_id: detailAgent,
            phone_config_id: detailPhoneIds[0] || null,
            delay_seconds: parseInt(detailDelay) || 30,
            enable_number_locking: detailNumberLocking,
          } as Campaign;
          const result = await startCampaignLocal(localCampaign, Array.from(selectedContactIds));
          toast({ title: "Campaign started", description: `${result.total || 0} calls queued locally` });
          openCampaignDetail(localCampaign);
          fetchData();
        } catch (localErr: any) {
          toast({ title: "Error", description: localErr.message || "Failed to start local campaign", variant: "destructive" });
        }
      } else {
        toast({ title: "Error", description: await getInvokeErrorMessage(err), variant: "destructive" });
      }
    } finally {
      setStartingCall(false);
      startCampaignInFlightRef.current = false;
    }
  };

  const toggleContactSelect = (id: string) => {
    setSelectedContactIdsState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return Array.from(next);
    });
  };
  const toggleAllContacts = () => {
    if (selectedContactIds.size === contacts.length) setSelectedContactIdsState([]);
    else setSelectedContactIdsState(contacts.map((ct) => ct.id));
  };

  const getContactEditableFields = (contact: any) => {
    const baseKeys = Object.keys(contact || {}).filter((key) => ![
      "id",
      "campaign_id",
      "user_id",
      "created_at",
      "updated_at",
      "metadata",
    ].includes(key));

    return Array.from(new Set([
      "first_name",
      "phone_number",
      ...baseKeys,
    ]));
  };

  const formatFieldLabel = (key: string) =>
    key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const openContactEditor = (contact: any) => {
    const nextForm: Record<string, string> = {};
    getContactEditableFields(contact).forEach((key) => {
      nextForm[key] = contact?.[key] == null ? "" : String(contact[key]);
    });

    const nextMetadataForm: Record<string, string> = {};
    const metadata = contact?.metadata && typeof contact.metadata === "object"
      ? contact.metadata as Record<string, any>
      : {};
    Object.entries(metadata).forEach(([key, value]) => {
      nextMetadataForm[key] = value == null ? "" : String(value);
    });

    setEditingContact(contact);
    setContactForm(nextForm);
    setContactMetadataForm(nextMetadataForm);
    setContactDialogOpen(true);
  };

  const saveContactEdits = async () => {
    if (!editingContact) return;

    setSavingContact(true);
    try {
      const payload: Record<string, any> = {};
      Object.entries(contactForm).forEach(([key, value]) => {
        payload[key] = value.trim() === "" ? null : value;
      });
      payload.metadata = Object.fromEntries(
        Object.entries(contactMetadataForm).map(([key, value]) => [key, value.trim() === "" ? null : value]),
      );

      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", editingContact.id);

      if (error) throw error;

      toast({ title: "Contact updated" });
      setContactDialogOpen(false);
      setEditingContact(null);
      if (selectedCampaign) {
        await openCampaignDetail(selectedCampaign);
      } else {
        await fetchData();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update contact",
        variant: "destructive",
      });
    } finally {
      setSavingContact(false);
    }
  };

  const deleteContact = async (contactId: string) => {
    try {
      const { error: detachError } = await supabase
        .from("call_outcomes")
        .update({ contact_id: null })
        .eq("contact_id", contactId);

      if (detachError) throw detachError;

      const { error } = await supabase.from("contacts").delete().eq("id", contactId);
      if (error) throw error;

      toast({ title: "Contact deleted" });
      if (selectedCampaign) {
        await openCampaignDetail(selectedCampaign);
      } else {
        await fetchData();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete contact",
        variant: "destructive",
      });
    }
  };

  const filtered = filter === "all" ? campaigns : campaigns.filter((c) => c.status === filter);
  const statusCounts = campaigns.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  const getAgentName = (id: string | null) => id ? agents.find(a => a.id === id)?.name || "Unknown" : "—";
  const getCampaignPhoneLabel = (id: string | null) => { if (!id) return "—"; const pc = phoneConfigs.find(p => p.id === id); return pc ? (pc.friendly_name || pc.phone_number) : "Unknown"; };
  const getPhoneLabels = (campaign: Campaign) => getCampaignPhoneIds(campaign).map((id) => getCampaignPhoneLabel(id)).filter((label) => label !== "Unknown");

  // Campaign detail view
  if (selectedCampaign) {
    const c = selectedCampaign;
    const totalOutcomes = Object.values(outcomeCounts).reduce((a, b) => a + b, 0);

    // Build dynamic columns from metadata if available
    const metadataCols: { key: string; label: string }[] = [];
    if (contacts.length > 0 && contacts[0]?.metadata && typeof contacts[0].metadata === "object") {
      const meta = contacts[0].metadata as Record<string, any>;
      Object.keys(meta).forEach((key) => {
        metadataCols.push({ key, label: key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) });
      });
    }

    // Use metadata columns if available, otherwise fall back to fixed columns
    const fixedCols = [
      { key: "first_name", label: "Name" },
      { key: "phone_number", label: "Phone" },
      { key: "venue_name", label: "Venue" },
      { key: "venue_location", label: "Location" },
      { key: "child_names", label: "Children" },
      { key: "age_range", label: "Age Range" },
      { key: "start_date", label: "Start Date" },
      { key: "end_date", label: "End Date" },
      { key: "times", label: "Times" },
      { key: "language", label: "Language" },
    ];

    const useMetadata = metadataCols.length > 0;
    const displayCols = useMetadata
      ? metadataCols.filter((col) =>
          contacts.some((ct) => {
            const val = (ct.metadata as Record<string, any>)?.[col.key];
            return val && val !== "" && val !== "en";
          })
        )
      : fixedCols.filter((col) =>
          col.key === "first_name" || col.key === "phone_number" ||
          contacts.some((ct) => ct[col.key] && ct[col.key] !== "en")
        );

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedCampaign(null); setSelectedCampaignId(null); }}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{c.venue_name}</h2>
            {c.venue_location && <p className="text-muted-foreground flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {c.venue_location}</p>}
          </div>
          <Badge className={`${STATUS_COLORS[c.status] || ""} text-sm px-3 py-1`}>{c.status}</Badge>
        </div>

        <div className="grid gap-4 grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Total Contacts</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <Users className="h-6 w-6 text-primary" />
                {contactCount}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>Calls Made</CardDescription>
              <CardTitle className="flex items-center gap-2 text-3xl">
                <Phone className="h-6 w-6 text-primary" />
                {c.calls_made}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {c.total_contacts > 0 && (
          <Card><CardContent className="pt-6"><div className="flex justify-between text-sm mb-2"><span className="text-muted-foreground">Call Progress</span><span className="font-medium">{c.calls_made} / {c.total_contacts}</span></div><Progress value={c.total_contacts > 0 ? (c.calls_made / c.total_contacts) * 100 : 0} className="h-3" /></CardContent></Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Campaign Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                {c.agent_id && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Agent:</span><span className="font-medium">{getAgentName(c.agent_id)}</span></div>}
                {getCampaignPhoneIds(c).length > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-28">Numbers:</span>
                    <span className="font-medium">{getPhoneLabels(c).join(", ")}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Delay:</span><span className="font-medium">{c.delay_seconds}s between calls</span></div>
                <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Locking:</span><span className="font-medium">{c.enable_number_locking ? "Enabled" : "Disabled"}</span></div>
                {c.age_range && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Age Range:</span><span className="font-medium">{c.age_range}</span></div>}
              </div>
              <div className="space-y-3">
                {c.start_date && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Dates:</span><span className="font-medium">{c.start_date} → {c.end_date || "TBD"}</span></div>}
                {c.times && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Times:</span><span className="font-medium">{c.times}</span></div>}
                <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground w-28">Created:</span><span className="font-medium">{new Date(c.created_at).toLocaleDateString()}</span></div>
              </div>
            </div>
            {c.notes && (
              <>
                <Separator className="my-4" />
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> Notes</p>
                  <p className="text-sm">{c.notes}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Contacts Table with Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Contacts ({contacts.length})
            </CardTitle>
            <CardDescription>{selectedContactIds.size} of {contacts.length} selected</CardDescription>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No contacts uploaded for this campaign.</p>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedContactIds.size === contacts.length && contacts.length > 0}
                          onCheckedChange={toggleAllContacts}
                        />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      {displayCols.map((col) => (
                        <TableHead key={col.key}>{col.label}</TableHead>
                      ))}
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((ct, idx) => (
                      <TableRow key={ct.id} className={selectedContactIds.has(ct.id) ? "bg-primary/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedContactIds.has(ct.id)}
                            onCheckedChange={() => toggleContactSelect(ct.id)}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        {displayCols.map((col) => {
                          const val = useMetadata
                            ? (ct.metadata as Record<string, any>)?.[col.key]
                            : ct[col.key];
                          return (
                            <TableCell key={col.key} className={col.key.includes("name") && !col.key.includes("child") ? "font-medium" : col.key.includes("phone") ? "font-mono text-xs" : ""}>
                              {val || "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openContactEditor(ct)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => deleteContact(ct.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Start Calling Section */}
        {contacts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Phone className="h-5 w-5" /> Start Calling</CardTitle>
              <CardDescription>Call {selectedContactIds.size} selected contacts using your AI agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Agent *</Label>
                  <Select value={detailAgent} onValueChange={setDetailAgent}>
                    <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
                    <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <MultiPhoneSelect
                    label="Phone Numbers *"
                    value={detailPhoneIds}
                    options={phoneConfigs}
                    onChange={setDetailPhoneIds}
                    helperText="Selected numbers rotate in round-robin order for outbound calls."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Delay Between Calls (sec)</Label>
                  <Input type="number" value={detailDelay} onChange={(e) => setDetailDelay(e.target.value)} min={5} />
                </div>
                <div className="space-y-2">
                  <Label>Number Locking</Label>
                  <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                    <Checkbox checked={detailNumberLocking} onCheckedChange={(checked) => setDetailNumberLocking(Boolean(checked))} />
                    <span className="text-sm">Only use one active call per number</span>
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <Button onClick={startSelectedCalls} disabled={startingCall || selectedContactIds.size === 0 || !detailAgent || detailPhoneIds.length === 0} size="lg">
                  {startingCall ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting Campaign...</> : <><Play className="h-4 w-4 mr-2" /> Call {selectedContactIds.size} Contacts</>}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => editCampaign(c)}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
          <Button variant="destructive" onClick={() => deleteCampaign(c.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
        </div>

        <Dialog
          open={contactDialogOpen}
          onOpenChange={(open) => {
            setContactDialogOpen(open);
            if (!open) {
              setEditingContact(null);
              setContactForm({});
              setContactMetadataForm({});
            }
          }}
        >
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.keys(contactForm).map((key) => (
                  <div key={key} className="space-y-2">
                    <Label>{formatFieldLabel(key)}</Label>
                    <Input
                      value={contactForm[key] ?? ""}
                      onChange={(e) => setContactForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              {Object.keys(contactMetadataForm).length > 0 && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium">Additional Details</h3>
                    <p className="text-sm text-muted-foreground">Metadata fields stored with this contact.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.keys(contactMetadataForm).map((key) => (
                      <div key={key} className="space-y-2">
                        <Label>{formatFieldLabel(key)}</Label>
                        <Input
                          value={contactMetadataForm[key] ?? ""}
                          onChange={(e) => setContactMetadataForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button type="button" onClick={saveContactEdits} disabled={savingContact}>
                  {savingContact ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Save Contact"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setContactDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingId(null)}><Plus className="h-4 w-4 mr-2" /> New Campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? "Edit Campaign" : "New Campaign"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2"><Label>Venue Name *</Label><Input value={form.venue_name} onChange={(e) => setForm({ ...form, venue_name: e.target.value })} required /></div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Location</Label><Input value={form.venue_location} onChange={(e) => setForm({ ...form, venue_location: e.target.value })} /></div>
                <div className="space-y-2"><Label>Age Range</Label><Input value={form.age_range} onChange={(e) => setForm({ ...form, age_range: e.target.value })} placeholder="e.g. 5-12" /></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                <div className="space-y-2"><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Agent</Label><Select value={form.agent_id} onValueChange={(v) => setForm({ ...form, agent_id: v })}><SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger><SelectContent>{agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select></div>
                <MultiPhoneSelect
                  label="Phone Numbers"
                  value={formPhoneIds}
                  options={phoneConfigs}
                  onChange={setFormPhoneIds}
                />
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Delay Between Calls (sec)</Label><Input type="number" value={form.delay_seconds} onChange={(e) => setForm({ ...form, delay_seconds: e.target.value })} min={5} /></div>
                <div className="space-y-2"><Label>Booking Target</Label><Input type="number" value={form.booking_target} onChange={(e) => setForm({ ...form, booking_target: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Checkbox
                  checked={form.enable_number_locking}
                  onCheckedChange={(checked) => setForm({ ...form, enable_number_locking: Boolean(checked) })}
                />
                <div>
                  <Label className="text-sm">Enable Number Locking</Label>
                  <p className="text-xs text-muted-foreground">Keep each number on only one active call at a time.</p>
                </div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Round</Label><Select value={String(form.round)} onValueChange={(v) => setForm({ ...form, round: parseInt(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Round 1</SelectItem><SelectItem value="2">Round 2</SelectItem><SelectItem value="3">Round 3</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="paused">Paused</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2"><Label>Times</Label><Input value={form.times} onChange={(e) => setForm({ ...form, times: e.target.value })} placeholder="e.g. 9am-3pm" /></div>
                <div className="space-y-2"><Label>Twilio Phone Number</Label><Input value={form.twilio_phone_number} onChange={(e) => setForm({ ...form, twilio_phone_number: e.target.value })} placeholder="+44..." /></div>
              </div>
              <div className="space-y-2"><Label>ElevenLabs Campaign ID</Label><Input value={form.elevenlabs_campaign_id} onChange={(e) => setForm({ ...form, elevenlabs_campaign_id: e.target.value })} placeholder="Optional" /></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
              <div className="flex gap-3"><Button type="submit">{editingId ? "Update" : "Create"}</Button><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "draft", "active", "paused", "completed"].map((s) => (
          <Button key={s} variant={filter === s ? "default" : "outline"} size="sm" onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Card key={i}><CardContent className="h-40 animate-pulse bg-muted/50 rounded-lg" /></Card>)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">No campaigns yet. Create one to get started.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="relative cursor-pointer hover:shadow-md transition-shadow" onClick={() => openCampaignDetail(c)}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{c.venue_name}</CardTitle>
                      {c.round > 1 && <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-5 min-w-max">Retry {c.round}</Badge>}
                    </div>
                    {c.venue_location && <CardDescription className="flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" /> {c.venue_location}</CardDescription>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); editCampaign(c); }}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); deleteCampaign(c.id); }}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <Badge className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge>
                  {c.age_range && <Badge variant="secondary">{c.age_range}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {c.start_date && <p className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {c.start_date} → {c.end_date || "TBD"}</p>}
                  {c.times && <p className="flex items-center gap-1"><Clock className="h-3 w-3" /> {c.times}</p>}
                  {c.agent_id && <p className="flex items-center gap-1"><Bot className="h-3 w-3" /> {getAgentName(c.agent_id)}</p>}
                  {getCampaignPhoneIds(c).length > 0 && <p className="flex items-center gap-1"><Phone className="h-3 w-3" /> {getPhoneLabels(c).join(", ")}</p>}
                  {c.booking_target && <p className="flex items-center gap-1"><Target className="h-3 w-3" /> Target: {c.booking_target}</p>}
                </div>
                {c.status === "active" && c.total_contacts > 0 && (
                  <div className="space-y-1">
                    <Progress value={(c.calls_made / c.total_contacts) * 100} className="h-2" />
                    <p className="text-xs text-muted-foreground">{c.calls_made} / {c.total_contacts} calls made</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
