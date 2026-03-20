import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { IncomingMessage, ServerResponse } from "node:http";

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sendNoContent(res: ServerResponse) {
  res.statusCode = 204;
  res.end();
}

const DEFAULT_RATE_PER_MINUTE = 0.1;
const FREE_SIGNUP_SECONDS = 300;
// Note: This is used at build time. Use VITE_ADMIN_EMAIL env var for dev/prod
const ADMIN_EMAIL = process.env.VITE_ADMIN_EMAIL || "saphaarelabs@gmail.com";

async function fetchSingleRow(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  table: string,
  query: string,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`Failed to load ${table}`);
  }
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function ensureLocalMinuteBalance(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  userId: string,
) {
  let balance = await fetchSingleRow(
    supabaseUrl,
    supabaseServiceRoleKey,
    "user_minute_balances",
    `user_id=eq.${encodeURIComponent(userId)}&select=*`,
  );

  if (!balance) {
    const createResponse = await fetch(`${supabaseUrl}/rest/v1/user_minute_balances`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        user_id: userId,
        available_seconds: FREE_SIGNUP_SECONDS,
        enterprise_rate_per_minute: DEFAULT_RATE_PER_MINUTE,
      }),
    });
    const createdRows = await createResponse.json().catch(() => []);
    if (!createResponse.ok) {
      throw new Error("Failed to initialize minute balance");
    }
    balance = Array.isArray(createdRows) ? createdRows[0] ?? null : null;

    await fetch(`${supabaseUrl}/rest/v1/minute_transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        kind: "signup_credit",
        source: "free",
        seconds_delta: FREE_SIGNUP_SECONDS,
        rate_per_minute: DEFAULT_RATE_PER_MINUTE,
        amount: 0,
        notes: "Automatic free signup minutes",
      }),
    });
  }

  return balance;
}

async function isLocalUnlimitedAdmin(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  userId: string,
) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error("Failed to load auth user");
  }
  return payload?.user?.email === ADMIN_EMAIL;
}

async function requireLocalPositiveBalance(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  userId: string,
) {
  if (await isLocalUnlimitedAdmin(supabaseUrl, supabaseServiceRoleKey, userId)) {
    return {
      user_id: userId,
      available_seconds: Number.POSITIVE_INFINITY,
      enterprise_rate_per_minute: DEFAULT_RATE_PER_MINUTE,
    };
  }
  const balance = await ensureLocalMinuteBalance(supabaseUrl, supabaseServiceRoleKey, userId);
  if (!balance || Number(balance.available_seconds || 0) <= 0) {
    throw new Error("No minutes left. Add minutes before starting another call.");
  }
  return balance;
}

async function creditLocalEnterpriseMinutes(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  userId: string,
  ratePerMinute: number,
  purchaseAmount: number,
) {
  const creditedMinutes = Math.floor(purchaseAmount / ratePerMinute);
  if (creditedMinutes <= 0) {
    throw new Error("Purchase amount is too low for the selected enterprise rate.");
  }

  const creditedSeconds = creditedMinutes * 60;
  const balance = await ensureLocalMinuteBalance(supabaseUrl, supabaseServiceRoleKey, userId);
  const currentSeconds = Number(balance?.available_seconds || 0);
  const nextSeconds = currentSeconds + creditedSeconds;

  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/user_minute_balances?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      available_seconds: nextSeconds,
      enterprise_rate_per_minute: ratePerMinute,
      last_enterprise_amount: purchaseAmount,
      last_enterprise_minutes: creditedMinutes,
      updated_at: new Date().toISOString(),
    }),
  });
  const updatedRows = await updateResponse.json().catch(() => []);
  if (!updateResponse.ok) {
    throw new Error("Failed to update user minute balance");
  }

  await fetch(`${supabaseUrl}/rest/v1/minute_transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      kind: "enterprise_credit",
      source: "direct",
      seconds_delta: creditedSeconds,
      rate_per_minute: ratePerMinute,
      amount: purchaseAmount,
      notes: "Admin enterprise credit",
    }),
  });

  return {
    creditedMinutes,
    creditedSeconds,
    availableSeconds: nextSeconds,
    balance: Array.isArray(updatedRows) ? updatedRows[0] ?? null : null,
  };
}

async function deductLocalCallMinutes(
  supabaseUrl: string,
  supabaseServiceRoleKey: string,
  userId: string,
  callLogId: string,
  durationSeconds: number,
  kind: "demo_deduction" | "live_deduction",
) {
  if (await isLocalUnlimitedAdmin(supabaseUrl, supabaseServiceRoleKey, userId)) {
    await fetch(`${supabaseUrl}/rest/v1/call_logs?id=eq.${encodeURIComponent(callLogId)}&user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        billing_status: "charged",
        billing_source: "admin_unlimited",
        billed_seconds: 0,
        billed_minutes: 0,
        billed_rate_per_minute: 0,
        billed_amount: 0,
      }),
    });

    return {
      billedSeconds: 0,
      unlimitedAdmin: true,
    };
  }

  const callLog = await fetchSingleRow(
    supabaseUrl,
    supabaseServiceRoleKey,
    "call_logs",
    `id=eq.${encodeURIComponent(callLogId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,billing_status`,
  );

  if (callLog?.billing_status === "charged") {
    return null;
  }

  const billedSeconds = Math.max(0, Number(durationSeconds || 0));
  const billedMinutes = Math.ceil(billedSeconds / 60);
  const balance = await ensureLocalMinuteBalance(supabaseUrl, supabaseServiceRoleKey, userId);
  const ratePerMinute = Number(balance?.enterprise_rate_per_minute || DEFAULT_RATE_PER_MINUTE);
  const availableSeconds = Number(balance?.available_seconds || 0);
  const remainingSeconds = Math.max(0, availableSeconds - billedSeconds);
  const billedAmount = Number((billedMinutes * ratePerMinute).toFixed(2));

  await fetch(`${supabaseUrl}/rest/v1/user_minute_balances?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      available_seconds: remainingSeconds,
      updated_at: new Date().toISOString(),
    }),
  });

  await fetch(`${supabaseUrl}/rest/v1/minute_transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: userId,
      call_log_id: callLogId,
      kind,
      source: "direct",
      seconds_delta: -billedSeconds,
      rate_per_minute: ratePerMinute,
      amount: billedAmount,
      notes: "Automatic call deduction",
    }),
  });

  await fetch(`${supabaseUrl}/rest/v1/call_logs?id=eq.${encodeURIComponent(callLogId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      billing_status: "charged",
      billing_source: "direct",
      billed_seconds: billedSeconds,
      billed_minutes: billedMinutes,
      billed_rate_per_minute: ratePerMinute,
      billed_amount: billedAmount,
    }),
  });

  return {
    remainingSeconds,
    billedSeconds,
    billedMinutes,
    billedAmount,
  };
}

async function insertTelnyxCallState(
  supabaseUrl: string,
  supabaseServiceRoleKey: string | undefined,
  payload: {
    call_control_id: string;
    join_url: string;
    telnyx_api_key: string;
    agent_id?: string | null;
    user_id?: string | null;
  },
) {
  if (!supabaseServiceRoleKey) {
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/telnyx_call_state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to store Telnyx call state: ${errorText}`);
  }
}

function normalizeUltravoxLanguageHint(languageHint: unknown) {
  const value = String(languageHint || "").trim();
  if (!value) return "en";

  const normalized = value.toLowerCase();
  const map: Record<string, string> = {
    english: "en",
    en: "en",
    "en-us": "en",
    "en-gb": "en",
    hindi: "hi",
    hi: "hi",
    "hi-in": "hi",
    telugu: "te",
    te: "te",
    "te-in": "te",
    tamil: "ta",
    ta: "ta",
    "ta-in": "ta",
    kannada: "kn",
    kn: "kn",
    "kn-in": "kn",
    malayalam: "ml",
    ml: "ml",
    "ml-in": "ml",
  };

  return map[normalized] || value;
}

function normalizeUltravoxCallData(callData: any, messagesData: any) {
  let duration: number | null = null;
  if (typeof callData?.billedDuration === "string") {
    const match = callData.billedDuration.match(/^([\d.]+)s$/);
    if (match) duration = Math.round(parseFloat(match[1]));
  }
  if (duration === null && callData?.joined && callData?.ended) {
    duration = Math.round((new Date(callData.ended).getTime() - new Date(callData.joined).getTime()) / 1000);
  }

  const messages = Array.isArray(messagesData?.results)
    ? messagesData.results
    : Array.isArray(messagesData)
    ? messagesData
    : [];

  const transcript = messages
    .filter((message: any) => typeof message?.text === "string" && message.text.trim().length > 0)
    .map((message: any) => {
      const role = message.role === "MESSAGE_ROLE_AGENT"
        ? "agent"
        : message.role === "MESSAGE_ROLE_USER"
        ? "user"
        : typeof message.role === "string" && message.role.startsWith("MESSAGE_ROLE_")
        ? message.role.replace("MESSAGE_ROLE_", "").toLowerCase()
        : message.role || "system";

      return {
        role,
        text: message.text,
        timestamp:
          message.wallClockTimespan?.start ||
          message.timespan?.start ||
          message.created ||
          message.callStageMessageIndex ||
          null,
      };
    });

  let status = callData?.ended ? "completed" : "in-progress";
  if (!callData?.joined && !callData?.ended) status = "initiated";
  if (callData?.endReason === "busy" || callData?.endReason === "voicemail") status = callData.endReason;
  if (callData?.endReason === "error" || callData?.endReason === "failed") status = "failed";

  return {
    duration,
    started_at: callData?.joined || callData?.created || null,
    ended_at: callData?.ended || null,
    status,
    summary: callData?.shortSummary || callData?.summary || null,
    transcript: transcript.length > 0 ? transcript : null,
  };
}

async function buildUltravoxCallBody(
  ultravoxApiKey: string,
  agent: any,
  provider: string,
) {
  const medium = provider === "telnyx" ? { telnyx: {} } : { twilio: {} };

  if (agent.ultravox_agent_id) {
    const response = await fetch(`https://api.ultravox.ai/api/agents/${agent.ultravox_agent_id}`, {
      headers: { "X-API-Key": ultravoxApiKey },
    });

    if (response.ok) {
      const agentData = await response.json();
      const template = agentData?.callTemplate;
      if (template) {
        const callBody: Record<string, unknown> = {
          systemPrompt: agent.system_prompt || template.systemPrompt,
          temperature: Number(agent.temperature ?? template.temperature ?? 0.7),
          model: template.model,
          voice: template.voice,
          externalVoice: template.externalVoice,
          languageHint: normalizeUltravoxLanguageHint(agent.language_hint || template.languageHint || "en"),
          initialMessages: template.initialMessages,
          joinTimeout: template.joinTimeout,
          maxDuration: agent.max_duration ? `${agent.max_duration}s` : template.maxDuration || "300s",
          timeExceededMessage: template.timeExceededMessage,
          inactivityMessages: template.inactivityMessages,
          selectedTools: template.selectedTools,
          medium,
          recordingEnabled: template.recordingEnabled,
          firstSpeaker: template.firstSpeaker,
          transcriptOptional: template.transcriptOptional,
          initialOutputMedium: template.initialOutputMedium,
          vadSettings: template.vadSettings,
          firstSpeakerSettings: template.firstSpeakerSettings,
          experimentalSettings: template.experimentalSettings,
        };

        return Object.fromEntries(
          Object.entries(callBody).filter(([, value]) => value !== undefined && value !== null),
        );
      }
    }
  }

  let modelName = agent.model || "fixie-ai/ultravox-v0.7";
  if (modelName && !String(modelName).includes("/")) {
    modelName = `fixie-ai/${modelName}`;
  }

  return {
    systemPrompt: agent.system_prompt,
    model: modelName,
    voice: agent.voice,
    temperature: Number(agent.temperature),
    firstSpeakerSettings: {
      user: {
        fallback: {
          delay: "2s",
          text: `Hello, this is ${agent.name || "MagicTeams AI"} calling.`,
        },
      },
    },
    medium,
    languageHint: normalizeUltravoxLanguageHint(agent.language_hint || "en"),
    maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
  };
}

async function buildUltravoxDemoCallBody(
  ultravoxApiKey: string,
  agent: any,
  systemPrompt: string,
  selectedTools: any[],
) {
  const dedupedSelectedTools = selectedTools.filter((tool, index, list) => {
    const toolName = tool?.temporaryTool?.modelToolName;
    if (!toolName) return true;
    return list.findIndex((candidate) => candidate?.temporaryTool?.modelToolName === toolName) === index;
  });

  if (agent.ultravox_agent_id) {
    const response = await fetch(`https://api.ultravox.ai/api/agents/${agent.ultravox_agent_id}`, {
      headers: { "X-API-Key": ultravoxApiKey },
    });

    if (response.ok) {
      const agentData = await response.json();
      const template = agentData?.callTemplate;
      if (template) {
        return Object.fromEntries(
          Object.entries({
            systemPrompt: systemPrompt || template.systemPrompt,
            temperature: Number(agent.temperature ?? template.temperature ?? 0.7),
            model: template.model,
            voice: template.voice,
            externalVoice: template.externalVoice,
            languageHint: normalizeUltravoxLanguageHint(agent.language_hint || template.languageHint || "en"),
            initialMessages: template.initialMessages,
            joinTimeout: template.joinTimeout,
            maxDuration: agent.max_duration ? `${agent.max_duration}s` : template.maxDuration || "300s",
            timeExceededMessage: template.timeExceededMessage,
            inactivityMessages: template.inactivityMessages,
            selectedTools: dedupedSelectedTools.length > 0 ? dedupedSelectedTools : template.selectedTools,
            recordingEnabled: template.recordingEnabled,
            firstSpeaker: template.firstSpeaker,
            transcriptOptional: template.transcriptOptional,
            initialOutputMedium: template.initialOutputMedium,
            vadSettings: template.vadSettings,
            firstSpeakerSettings: template.firstSpeakerSettings,
            experimentalSettings: template.experimentalSettings,
            metadata: template.metadata,
            initialState: template.initialState,
            dataConnection: template.dataConnection,
            callbacks: template.callbacks,
            voiceOverrides: template.voiceOverrides,
          }).filter(([, value]) => value !== undefined && value !== null),
        );
      }
    }
  }

  let modelName = agent.model || "fixie-ai/ultravox-v0.7";
  if (modelName && !String(modelName).includes("/")) {
    modelName = `fixie-ai/${modelName}`;
  }

  const callBody: Record<string, unknown> = {
    systemPrompt,
    model: modelName,
    voice: agent.voice,
    temperature: Number(agent.temperature),
    firstSpeakerSettings: agent.first_speaker === "FIRST_SPEAKER_AGENT" ? { agent: {} } : { user: {} },
    languageHint: normalizeUltravoxLanguageHint(agent.language_hint || "en"),
    maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
  };
  if (dedupedSelectedTools.length > 0) {
    callBody.selectedTools = dedupedSelectedTools;
  }
  return callBody;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      {
        name: "local-outbound-call-route",
        configureServer(server) {
          server.middlewares.use("/api/local/ultravox-call-details", async (req, res) => {
            if (req.method !== "GET") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const url = new URL(req.url || "", "http://localhost");
              const callId = url.searchParams.get("callId");
              const ultravoxApiKey = env.VITE_ULTRAVOX_API_KEY || env.ULTRAVOX_API_KEY;

              if (!callId) {
                sendJson(res, 400, { error: "callId is required" });
                return;
              }
              if (!ultravoxApiKey) {
                sendJson(res, 500, { error: "Ultravox API key is not configured" });
                return;
              }

              const [callResponse, messagesResponse] = await Promise.all([
                fetch(`https://api.ultravox.ai/api/calls/${callId}`, {
                  headers: { "X-API-Key": ultravoxApiKey },
                }),
                fetch(`https://api.ultravox.ai/api/calls/${callId}/messages?mode=in_call&pageSize=500`, {
                  headers: { "X-API-Key": ultravoxApiKey },
                }),
              ]);

              const callData = await callResponse.json().catch(() => ({}));
              const messagesData = await messagesResponse.json().catch(() => ({}));

              if (!callResponse.ok) {
                if (callResponse.status === 404) {
                  sendNoContent(res);
                  return;
                }
                sendJson(res, 200, {
                  unavailable: true,
                  error: callData?.message || callData?.error || "Failed to fetch Ultravox call",
                });
                return;
              }

              if (!messagesResponse.ok) {
                sendJson(res, 200, {
                  ...normalizeUltravoxCallData(callData, []),
                  unavailable: true,
                  error: messagesData?.message || messagesData?.error || "Failed to fetch Ultravox transcript",
                });
                return;
              }

              sendJson(res, 200, normalizeUltravoxCallData(callData, messagesData));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 200, { unavailable: true, error: message });
            }
          });

          server.middlewares.use("/api/local/outbound-call", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const {
                agent,
                phoneConfig,
                recipientNumber,
                userId,
              } = await readJsonBody(req);

              if (!agent || !phoneConfig || !recipientNumber || !userId) {
                sendJson(res, 400, { error: "agent, phoneConfig, recipientNumber and userId are required" });
                return;
              }

              const ultravoxApiKey = env.VITE_ULTRAVOX_API_KEY || env.ULTRAVOX_API_KEY;
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
              const geminiApiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;
              const sarvamApiKey = env.SARVAM_API_KEY;
              if (!ultravoxApiKey) {
                sendJson(res, 500, { error: "Ultravox API key is not configured" });
                return;
              }
              if (!supabaseUrl) {
                sendJson(res, 500, { error: "Supabase URL is not configured" });
                return;
              }

              await requireLocalPositiveBalance(supabaseUrl, supabaseServiceRoleKey!, userId);

                const provider = phoneConfig.provider || "twilio";
                const aiProvider = agent.ai_provider || "ultravox";
                let providerCallId = "";
              let outboundAiCallId = "";

              if (aiProvider === "gemini") {
                if (!geminiApiKey) {
                  sendJson(res, 500, { error: "Gemini API key is not configured" });
                  return;
                }

                const bridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge`.replace("https://", "wss://");
                const telnyxBridgeUrl = `${supabaseUrl}/functions/v1/gemini-voice-bridge?agent_id=${agent.id}&provider=telnyx`.replace("https://", "wss://");

                if (provider === "telnyx") {
                  const telnyxApiKey = String(phoneConfig.telnyx_api_key || "").trim();
                  const telnyxConnectionId = String(phoneConfig.telnyx_connection_id || "").trim();
                  if (!telnyxApiKey || !telnyxConnectionId) {
                    sendJson(res, 400, { error: "Telnyx API key or connection ID is missing" });
                    return;
                  }

                  const telnyxResponse = await fetch("https://api.telnyx.com/v2/calls", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${telnyxApiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      connection_id: telnyxConnectionId,
                      to: recipientNumber,
                      from: phoneConfig.phone_number,
                      webhook_url: `${supabaseUrl}/functions/v1/handle-telnyx-webhook`,
                      timeout_secs: 30,
                    }),
                  });

                  const telnyxData = await telnyxResponse.json();
                  if (!telnyxResponse.ok) {
                    sendJson(res, 500, { error: telnyxData?.errors?.[0]?.detail || "Failed to place Telnyx call" });
                    return;
                  }

                  providerCallId = telnyxData?.data?.call_control_id || "";
                  await insertTelnyxCallState(supabaseUrl, supabaseServiceRoleKey, {
                    call_control_id: providerCallId,
                    join_url: telnyxBridgeUrl,
                    telnyx_api_key: telnyxApiKey,
                    agent_id: agent.id || null,
                    user_id: agent.user_id || phoneConfig.user_id || null,
                  });
                  outboundAiCallId = providerCallId;
                } else {
                  const twilioAccountSid = String(phoneConfig.twilio_account_sid || "").trim();
                  const twilioAuthToken = String(phoneConfig.twilio_auth_token || "").trim();
                  if (!twilioAccountSid || !twilioAuthToken) {
                    sendJson(res, 400, { error: "Twilio Account SID or Auth Token is missing" });
                    return;
                  }

                  const twiml = `<Response><Connect><Stream url="${bridgeUrl}"><Parameter name="agent_id" value="${agent.id}"/></Stream></Connect></Response>`;
                  const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
                    method: "POST",
                    headers: {
                      Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      To: recipientNumber,
                      From: phoneConfig.phone_number,
                      Twiml: twiml,
                    }).toString(),
                  });

                  const twilioData = await twilioResponse.json();
                  if (!twilioResponse.ok) {
                    sendJson(res, 500, { error: twilioData?.message || "Failed to place Twilio call" });
                    return;
                  }

                  providerCallId = twilioData?.sid || "";
                  outboundAiCallId = providerCallId;
                }
              } else if (aiProvider === "sarvam") {
                if (!sarvamApiKey) {
                  sendJson(res, 500, { error: "Sarvam API key is not configured" });
                  return;
                }

                const bridgeUrl = `${supabaseUrl}/functions/v1/sarvam-voice-bridge`.replace("https://", "wss://");
                const telnyxBridgeUrl = `${supabaseUrl}/functions/v1/sarvam-voice-bridge?agent_id=${agent.id}&provider=telnyx`.replace("https://", "wss://");

                if (provider === "telnyx") {
                  const telnyxApiKey = String(phoneConfig.telnyx_api_key || "").trim();
                  const telnyxConnectionId = String(phoneConfig.telnyx_connection_id || "").trim();
                  if (!telnyxApiKey || !telnyxConnectionId) {
                    sendJson(res, 400, { error: "Telnyx API key or connection ID is missing" });
                    return;
                  }

                  const telnyxResponse = await fetch("https://api.telnyx.com/v2/calls", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${telnyxApiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      connection_id: telnyxConnectionId,
                      to: recipientNumber,
                      from: phoneConfig.phone_number,
                      webhook_url: `${supabaseUrl}/functions/v1/handle-telnyx-webhook`,
                      timeout_secs: 30,
                    }),
                  });

                  const telnyxData = await telnyxResponse.json();
                  if (!telnyxResponse.ok) {
                    sendJson(res, 500, { error: telnyxData?.errors?.[0]?.detail || "Failed to place Telnyx call" });
                    return;
                  }

                  providerCallId = telnyxData?.data?.call_control_id || "";
                  await insertTelnyxCallState(supabaseUrl, supabaseServiceRoleKey, {
                    call_control_id: providerCallId,
                    join_url: telnyxBridgeUrl,
                    telnyx_api_key: telnyxApiKey,
                    agent_id: agent.id || null,
                    user_id: agent.user_id || phoneConfig.user_id || null,
                  });
                  outboundAiCallId = providerCallId;
                } else {
                  const twilioAccountSid = String(phoneConfig.twilio_account_sid || "").trim();
                  const twilioAuthToken = String(phoneConfig.twilio_auth_token || "").trim();
                  if (!twilioAccountSid || !twilioAuthToken) {
                    sendJson(res, 400, { error: "Twilio Account SID or Auth Token is missing" });
                    return;
                  }

                  const twiml = `<Response><Connect><Stream url="${bridgeUrl}"><Parameter name="agent_id" value="${agent.id}"/><Parameter name="provider" value="twilio"/></Stream></Connect></Response>`;
                  const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
                    method: "POST",
                    headers: {
                      Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      To: recipientNumber,
                      From: phoneConfig.phone_number,
                      Twiml: twiml,
                    }).toString(),
                  });

                  const twilioData = await twilioResponse.json();
                  if (!twilioResponse.ok) {
                    sendJson(res, 500, { error: twilioData?.message || "Failed to place Twilio call" });
                    return;
                  }

                  providerCallId = twilioData?.sid || "";
                  outboundAiCallId = providerCallId;
                }
              } else {
                const ultravoxBody = await buildUltravoxCallBody(
                  ultravoxApiKey,
                  agent,
                  provider,
                );

                const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": ultravoxApiKey,
                  },
                  body: JSON.stringify(ultravoxBody),
                });

                const ultravoxRaw = await ultravoxResponse.text();
                const ultravoxData = (() => {
                  if (!ultravoxRaw) return {};
                  try {
                    return JSON.parse(ultravoxRaw);
                  } catch {
                    return {};
                  }
                })();
                if (!ultravoxResponse.ok) {
                  sendJson(res, 500, {
                    error: ultravoxData?.message || ultravoxData?.error || "Failed to create Ultravox call",
                    details: ultravoxData?.details || ultravoxData || ultravoxRaw,
                  });
                  return;
                }

                const joinUrl = ultravoxData.joinUrl as string;
                outboundAiCallId = ultravoxData.callId as string;

                if (provider === "telnyx") {
                  const telnyxApiKey = String(phoneConfig.telnyx_api_key || "").trim();
                  const telnyxConnectionId = String(phoneConfig.telnyx_connection_id || "").trim();
                  if (!telnyxApiKey || !telnyxConnectionId) {
                    sendJson(res, 400, { error: "Telnyx API key or connection ID is missing" });
                    return;
                  }

                  const telnyxResponse = await fetch("https://api.telnyx.com/v2/calls", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${telnyxApiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      connection_id: telnyxConnectionId,
                      to: recipientNumber,
                      from: phoneConfig.phone_number,
                      webhook_url: `${supabaseUrl}/functions/v1/handle-telnyx-webhook`,
                      timeout_secs: 30,
                    }),
                  });

                  const telnyxData = await telnyxResponse.json();
                  if (!telnyxResponse.ok) {
                    sendJson(res, 500, { error: telnyxData?.errors?.[0]?.detail || "Failed to place Telnyx call" });
                    return;
                  }

                  providerCallId = telnyxData?.data?.call_control_id || "";
                  await insertTelnyxCallState(supabaseUrl, supabaseServiceRoleKey, {
                    call_control_id: providerCallId,
                    join_url: joinUrl,
                    telnyx_api_key: telnyxApiKey,
                    agent_id: agent.id || null,
                    user_id: agent.user_id || phoneConfig.user_id || null,
                  });
                } else {
                  const twilioAccountSid = String(phoneConfig.twilio_account_sid || "").trim();
                  const twilioAuthToken = String(phoneConfig.twilio_auth_token || "").trim();
                  if (!twilioAccountSid || !twilioAuthToken) {
                    sendJson(res, 400, { error: "Twilio Account SID or Auth Token is missing" });
                    return;
                  }

                  const twiml = `<Response><Connect><Stream url="${joinUrl}" /></Connect></Response>`;
                  const twilioResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`, {
                    method: "POST",
                    headers: {
                      Authorization: `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64")}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      To: recipientNumber,
                      From: phoneConfig.phone_number,
                      Twiml: twiml,
                    }).toString(),
                  });

                  const twilioData = await twilioResponse.json();
                  if (!twilioResponse.ok) {
                    sendJson(res, 500, { error: twilioData?.message || "Failed to place Twilio call" });
                    return;
                  }

                  providerCallId = twilioData?.sid || "";
                }
              }

              sendJson(res, 200, {
                success: true,
                providerCallId,
                ultravoxCallId: outboundAiCallId,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
            }
          });

          server.middlewares.use("/api/local/create-demo-call", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              let stage = "read-body";
              const { agentId, userId } = await readJsonBody(req);
              const ultravoxApiKey = env.VITE_ULTRAVOX_API_KEY || env.ULTRAVOX_API_KEY;
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

              if (!agentId || !userId) {
                sendJson(res, 400, { error: "agentId and userId are required" });
                return;
              }
              if (!ultravoxApiKey) {
                sendJson(res, 500, { error: "Ultravox API key is not configured" });
                return;
              }
              if (!supabaseUrl || !supabaseServiceRoleKey) {
                sendJson(res, 500, { error: "Supabase service role credentials are not configured" });
                return;
              }

              await requireLocalPositiveBalance(supabaseUrl, supabaseServiceRoleKey, userId);

              stage = "load-agent";
              const agentResponse = await fetch(
                `${supabaseUrl}/rest/v1/agents?id=eq.${encodeURIComponent(agentId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
                {
                  headers: {
                    apikey: supabaseServiceRoleKey,
                    Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  },
                },
              );
              const agentRows = await agentResponse.json().catch(() => []);
              const agent = Array.isArray(agentRows) ? agentRows[0] : null;

              if (!agentResponse.ok || !agent) {
                sendJson(res, 404, {
                  error: "Agent not found",
                  stage,
                  details: Array.isArray(agentRows) ? null : agentRows,
                });
                return;
              }

              const serviceHeaders = {
                apikey: supabaseServiceRoleKey,
                Authorization: `Bearer ${supabaseServiceRoleKey}`,
              };
              const fetchOptionalRows = async (nextStage: string, url: string) => {
                stage = nextStage;
                const response = await fetch(url, { headers: serviceHeaders });
                const data = await response.json().catch(() => []);
                if (!response.ok) {
                  console.error(`[local demo call] optional fetch failed at ${nextStage}`, data);
                  return [];
                }
                return Array.isArray(data) ? data : [];
              };

              const kbItems = await fetchOptionalRows(
                "load-kb",
                `${supabaseUrl}/rest/v1/knowledge_base_items?agent_id=eq.${encodeURIComponent(agent.id)}&select=*`,
              );
              const agentTools = await fetchOptionalRows(
                "load-agent-tools",
                `${supabaseUrl}/rest/v1/agent_tools?agent_id=eq.${encodeURIComponent(agent.id)}&is_active=eq.true&select=*`,
              );
              const appointmentTools = await fetchOptionalRows(
                "load-appointment-tools",
                `${supabaseUrl}/rest/v1/appointment_tools?agent_id=eq.${encodeURIComponent(agent.id)}&is_active=eq.true&select=*,calendar_integrations(*)`,
              );
              const forwardingNumbers = await fetchOptionalRows(
                "load-forwarding",
                `${supabaseUrl}/rest/v1/call_forwarding_numbers?agent_id=eq.${encodeURIComponent(agent.id)}&select=*&order=priority.asc`,
              );

              let systemPrompt = agent.system_prompt || "";
              const now = new Date();
              systemPrompt += `\n\n--- CURRENT DATE & TIME ---\nToday is ${now.toISOString().split("T")[0]} (${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}). Current time (UTC): ${now.toISOString()}.\n`;
              if (Array.isArray(kbItems) && kbItems.length > 0) {
                systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
                for (const item of kbItems) {
                  if (item?.content) systemPrompt += `\n## ${item.title}\n${item.content}\n`;
                  else if (item?.website_url) systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
                }
              }

              const KNOWN_VALUE_MAP: Record<string, string> = {
                "call.id": "KNOWN_PARAM_CALL_ID",
                "call.stage_id": "KNOWN_PARAM_CALL_STAGE_ID",
                "call.state": "KNOWN_PARAM_CALL_STATE",
                "call.conversation_history": "KNOWN_PARAM_CONVERSATION_HISTORY",
                "call.sample_rate": "KNOWN_PARAM_CALL_SAMPLE_RATE",
              };
              const END_BEHAVIOR_MAP: Record<string, string> = {
                "Speaks": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS",
                "Listens": "AGENT_TEXT_BEHAVIOR_AGENT_LISTENS",
                "Speaks Once": "AGENT_TEXT_BEHAVIOR_AGENT_SPEAKS_ONCE",
              };
              const locationToUltravox = (loc: string) => {
                if (loc === "header") return "PARAMETER_LOCATION_HEADER";
                if (loc === "query") return "PARAMETER_LOCATION_QUERY";
                return "PARAMETER_LOCATION_BODY";
              };
              const selectedTools: any[] = [];

              if (Array.isArray(agentTools)) {
                for (const tool of agentTools) {
                  const dynamicParameters: any[] = [];
                  const automaticParameters: any[] = [];
                  if (Array.isArray(tool.parameters)) {
                    for (const p of tool.parameters as any[]) {
                      if (p.paramType === "automatic") {
                        automaticParameters.push({
                          name: p.name,
                          location: locationToUltravox(p.location),
                          knownValue: KNOWN_VALUE_MAP[p.knownValue] || p.knownValue,
                        });
                      } else {
                        dynamicParameters.push({
                          name: p.name,
                          location: locationToUltravox(p.location),
                          schema: p.schema || { type: p.type || "string", description: p.description || "" },
                          required: !!p.required,
                        });
                      }
                    }
                  }

                  const staticParameters: any[] = [];
                  if (tool.http_headers && typeof tool.http_headers === "object") {
                    for (const [headerName, headerValue] of Object.entries(tool.http_headers as Record<string, string>)) {
                      if (headerName && headerValue) {
                        staticParameters.push({
                          name: headerName,
                          location: "PARAMETER_LOCATION_HEADER",
                          value: headerValue,
                        });
                      }
                    }
                  }
                  if (tool.http_body_template && typeof tool.http_body_template === "object") {
                    for (const [key, value] of Object.entries(tool.http_body_template as Record<string, any>)) {
                      if (key.startsWith("__")) continue;
                      staticParameters.push({
                        name: key,
                        location: "PARAMETER_LOCATION_BODY",
                        value: String(value),
                      });
                    }
                  }

                  const bodyMeta = (tool.http_body_template as Record<string, any>) || {};
                  const temporaryTool: any = {
                    modelToolName: tool.name,
                    description: tool.description,
                    dynamicParameters,
                    http: {
                      baseUrlPattern: tool.http_url,
                      httpMethod: tool.http_method,
                    },
                  };
                  if (staticParameters.length > 0) temporaryTool.staticParameters = staticParameters;
                  if (automaticParameters.length > 0) temporaryTool.automaticParameters = automaticParameters;
                  if (bodyMeta.__agentEndBehavior && END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior]) {
                    temporaryTool.defaultReaction = END_BEHAVIOR_MAP[bodyMeta.__agentEndBehavior];
                  }
                  if (bodyMeta.__staticResponse) {
                    temporaryTool.staticResponse = bodyMeta.__staticResponse;
                  }
                  selectedTools.push({ temporaryTool });
                }
              }

              if (Array.isArray(appointmentTools) && appointmentTools.length > 0) {
                const checkAvailabilityUrl = `${supabaseUrl}/functions/v1/check-calendar-availability`;
                const bookAppointmentUrl = `${supabaseUrl}/functions/v1/book-calendar-appointment`;

                for (const apptTool of appointmentTools) {
                  const integration = apptTool?.calendar_integrations;
                  if (!integration) continue;

                  const enabledDays = Object.entries((apptTool.business_hours || {}) as Record<string, any>)
                    .filter(([_, v]: any) => v.enabled)
                    .map(([day, v]: any) => `${day}: ${v.start}-${v.end}`)
                    .join(", ");
                  const typesList = Array.isArray(apptTool.appointment_types)
                    ? apptTool.appointment_types.map((t: any) => `${t.name} (${t.duration}min)`).join(", ")
                    : "";

                  systemPrompt += `\n\n--- APPOINTMENT TOOL: ${apptTool.name} ---`;
                  systemPrompt += `\nProvider: ${apptTool.provider}`;
                  systemPrompt += `\nBusiness Hours: ${enabledDays}`;
                  systemPrompt += `\nAppointment Types: ${typesList}`;
                  systemPrompt += `\nUse check_availability_${String(apptTool.name).replace(/[^a-zA-Z0-9]/g, "_")} to check calendar availability.`;
                  systemPrompt += `\nUse book_appointment_${String(apptTool.name).replace(/[^a-zA-Z0-9]/g, "_")} to book an appointment.\n`;

                  const toolNameSuffix = String(apptTool.name).replace(/[^a-zA-Z0-9]/g, "_");
                  const authHeaders = [{ name: "x-ultravox-tool-key", location: "PARAMETER_LOCATION_HEADER", value: ultravoxApiKey }];

                  selectedTools.push({
                    temporaryTool: {
                      modelToolName: `check_availability_${toolNameSuffix}`,
                      description: `Check calendar availability for ${apptTool.name}. Returns available time slots for a given date.`,
                      dynamicParameters: [
                        { name: "date", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Date to check availability (YYYY-MM-DD format)" }, required: true },
                        { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Desired meeting duration in minutes" }, required: false },
                      ],
                      http: { baseUrlPattern: checkAvailabilityUrl, httpMethod: "POST" },
                      staticParameters: [
                        { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
                        { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
                        ...authHeaders,
                      ],
                    },
                  });

                  selectedTools.push({
                    temporaryTool: {
                      modelToolName: `book_appointment_${toolNameSuffix}`,
                      description: `Book an appointment using ${apptTool.name}. Schedule a meeting at a specific date and time.`,
                      dynamicParameters: [
                        { name: "start_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Start time in ISO 8601 format" }, required: true },
                        { name: "end_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "End time in ISO 8601 format. Optional if duration_minutes is provided" }, required: false },
                        { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Duration in minutes if end_time is omitted" }, required: false },
                        { name: "attendee_name", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Name of the person booking" }, required: true },
                        { name: "attendee_email", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Email of the person booking" }, required: false },
                        { name: "attendee_phone", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Phone number of the person booking" }, required: false },
                        { name: "notes", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Additional notes" }, required: false },
                      ],
                      http: { baseUrlPattern: bookAppointmentUrl, httpMethod: "POST" },
                      staticParameters: [
                        { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
                        { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
                        ...authHeaders,
                      ],
                    },
                  });
                }
              }

              if (Array.isArray(forwardingNumbers) && forwardingNumbers.length > 0) {
                const numbersList = forwardingNumbers.map((fn: any, i: number) => `${i + 1}. ${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");
                systemPrompt += `\n\n--- CALL FORWARDING ---`;
                systemPrompt += `\nYou can transfer the caller to a human agent if they request it or if you cannot help them.`;
                systemPrompt += `\nAvailable transfer destinations (in priority order): ${numbersList}`;
                systemPrompt += `\nAlways confirm with the caller before transferring.\n`;
              }

              stage = "build-ultravox-body";
              const ultravoxBody = await buildUltravoxDemoCallBody(ultravoxApiKey, agent, systemPrompt, selectedTools);
              stage = "create-ultravox-call";
              const ultravoxResponse = await fetch("https://api.ultravox.ai/api/calls", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-API-Key": ultravoxApiKey,
                },
                body: JSON.stringify(ultravoxBody),
              });
              const ultravoxRaw = await ultravoxResponse.text();
              const ultravoxData = (() => {
                if (!ultravoxRaw) return {};
                try {
                  return JSON.parse(ultravoxRaw);
                } catch {
                  return {};
                }
              })();

              if (!ultravoxResponse.ok) {
                sendJson(res, 500, {
                  error: ultravoxData?.message || ultravoxData?.error || "Failed to create demo call",
                  stage,
                  details: ultravoxData?.details || ultravoxData || ultravoxRaw,
                });
                return;
              }

              stage = "create-call-log";
              const logResponse = await fetch(`${supabaseUrl}/rest/v1/call_logs`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: supabaseServiceRoleKey,
                  Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  Prefer: "return=representation",
                },
                body: JSON.stringify({
                  user_id: userId,
                  agent_id: agent.id,
                  direction: "demo",
                  caller_number: "browser-demo",
                  recipient_number: null,
                  ultravox_call_id: ultravoxData.callId || null,
                  status: "initiated",
                }),
              });
              const logRows = await logResponse.json().catch(() => []);
              if (!logResponse.ok || !Array.isArray(logRows) || !logRows[0]?.id) {
                sendJson(res, 500, {
                  error: "Failed to create demo call log",
                  stage,
                  details: logRows,
                });
                return;
              }

              sendJson(res, 200, {
                success: true,
                joinUrl: ultravoxData.joinUrl,
                callId: ultravoxData.callId || null,
                logId: logRows[0].id,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error("[local demo call] fatal error", error);
              sendJson(res, 500, { error: message });
            }
          });

          server.middlewares.use("/api/local/finalize-demo-call", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const { logId, userId, status, endedAt, duration, transcript, ultravoxCallId } = await readJsonBody(req);
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

              if (!logId || !userId) {
                sendJson(res, 400, { error: "logId and userId are required" });
                return;
              }
              if (!supabaseUrl || !supabaseServiceRoleKey) {
                sendJson(res, 500, { error: "Supabase service role credentials are not configured" });
                return;
              }

              const updatePayload: Record<string, unknown> = {
                status: status || "completed",
                ended_at: endedAt || new Date().toISOString(),
                duration: Number(duration || 0),
                transcript: transcript || [],
              };
              if (ultravoxCallId) {
                updatePayload.ultravox_call_id = ultravoxCallId;
              }

              const response = await fetch(`${supabaseUrl}/rest/v1/call_logs?id=eq.${encodeURIComponent(logId)}&user_id=eq.${encodeURIComponent(userId)}&direction=eq.demo`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  apikey: supabaseServiceRoleKey,
                  Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  Prefer: "return=minimal",
                },
                body: JSON.stringify(updatePayload),
              });

              if (!response.ok) {
                const errorText = await response.text();
                sendJson(res, 500, { error: `Failed to finalize demo call: ${errorText}` });
                return;
              }

              await deductLocalCallMinutes(
                supabaseUrl,
                supabaseServiceRoleKey,
                userId,
                logId,
                Number(duration || 0),
                "demo_deduction",
              );

              sendJson(res, 200, { success: true });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
            }
          });

          server.middlewares.use("/api/local/admin-list-clients", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

              if (!supabaseUrl || !supabaseServiceRoleKey) {
                sendJson(res, 500, { error: "Supabase service role credentials are not configured" });
                return;
              }

              const [profilesResponse, usersResponse, balancesResponse] = await Promise.all([
                fetch(`${supabaseUrl}/rest/v1/profiles?select=user_id,full_name,company_name`, {
                  headers: {
                    apikey: supabaseServiceRoleKey,
                    Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  },
                }),
                fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
                  headers: {
                    apikey: supabaseServiceRoleKey,
                    Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  },
                }),
                fetch(`${supabaseUrl}/rest/v1/user_minute_balances?select=user_id,available_seconds,enterprise_rate_per_minute,last_enterprise_amount,last_enterprise_minutes`, {
                  headers: {
                    apikey: supabaseServiceRoleKey,
                    Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  },
                }),
              ]);

              const profiles = await profilesResponse.json().catch(() => []);
              const usersPayload = await usersResponse.json().catch(() => ({}));
              const balances = await balancesResponse.json().catch(() => []);

              if (!profilesResponse.ok) {
                sendJson(res, 500, { error: "Failed to load profiles from Supabase" });
                return;
              }
              if (!usersResponse.ok) {
                sendJson(res, 500, { error: usersPayload?.msg || usersPayload?.error || "Failed to load auth users from Supabase" });
                return;
              }
              if (!balancesResponse.ok) {
                sendJson(res, 500, { error: "Failed to load client balances from Supabase" });
                return;
              }

              const userMap = new Map(
                (Array.isArray(usersPayload?.users) ? usersPayload.users : []).map((account: any) => [account.id, account]),
              );
              const balanceMap = new Map(
                (Array.isArray(balances) ? balances : []).map((balance: any) => [balance.user_id, balance]),
              );

              const clients = (Array.isArray(profiles) ? profiles : [])
                .map((profile: any) => {
                  const account = userMap.get(profile.user_id);
                  if (!account?.email || account.email === "saphaarelabs@gmail.com") {
                    return null;
                  }
                  const metadata = account.user_metadata || {};
                  const balance = balanceMap.get(profile.user_id) || {};

                  return {
                    user_id: profile.user_id,
                    email: account.email,
                    full_name: profile?.full_name || (typeof metadata.full_name === "string" ? metadata.full_name : null),
                    company_name: profile?.company_name || null,
                    enterprise_interest: Boolean(metadata.enterprise_interest),
                    available_seconds: Number(balance.available_seconds || 0),
                    enterprise_rate_per_minute: balance.enterprise_rate_per_minute != null ? Number(balance.enterprise_rate_per_minute) : null,
                    last_enterprise_amount: balance.last_enterprise_amount != null ? Number(balance.last_enterprise_amount) : null,
                    last_enterprise_minutes: balance.last_enterprise_minutes != null ? Number(balance.last_enterprise_minutes) : null,
                  };
                })
                .filter((client: any) => client !== null)
                .sort((a: any, b: any) => {
                  if (a.enterprise_interest !== b.enterprise_interest) {
                    return a.enterprise_interest ? -1 : 1;
                  }
                  return String(a.email).localeCompare(String(b.email));
                });

              sendJson(res, 200, { clients });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
            }
          });

          server.middlewares.use("/api/local/admin-update-client-enterprise", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
              const { client_user_id, enterprise_rate_per_minute, purchase_amount } = await readJsonBody(req);

              if (!supabaseUrl || !supabaseServiceRoleKey) {
                sendJson(res, 500, { error: "Supabase service role credentials are not configured" });
                return;
              }
              if (!client_user_id || enterprise_rate_per_minute == null || purchase_amount == null) {
                sendJson(res, 400, { error: "client_user_id, enterprise_rate_per_minute and purchase_amount are required" });
                return;
              }

              const ratePerMinute = Number(enterprise_rate_per_minute);
              const purchaseAmount = Number(purchase_amount);
              if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
                sendJson(res, 400, { error: "enterprise_rate_per_minute must be a valid positive number" });
                return;
              }
              if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
                sendJson(res, 400, { error: "purchase_amount must be a valid positive number" });
                return;
              }

              const credit = await creditLocalEnterpriseMinutes(
                supabaseUrl,
                supabaseServiceRoleKey,
                client_user_id,
                ratePerMinute,
                purchaseAmount,
              );

              const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(client_user_id)}`, {
                headers: {
                  apikey: supabaseServiceRoleKey,
                  Authorization: `Bearer ${supabaseServiceRoleKey}`,
                },
              });
              const userPayload = await userResponse.json().catch(() => ({}));
              if (!userResponse.ok || !userPayload?.user) {
                sendJson(res, 200, { success: true, user: null, credit });
                return;
              }

              const currentMetadata = userPayload.user.user_metadata || {};
              const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(client_user_id)}`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  apikey: supabaseServiceRoleKey,
                  Authorization: `Bearer ${supabaseServiceRoleKey}`,
                },
                body: JSON.stringify({
                  user_metadata: {
                    ...currentMetadata,
                    enterprise_interest: false,
                    enterprise_updated_by: "saphaarelabs@gmail.com",
                    enterprise_updated_at: new Date().toISOString(),
                  },
                }),
              });

              const updatePayload = await updateResponse.json().catch(() => ({}));
              if (!updateResponse.ok) {
                sendJson(res, 200, { success: true, user: userPayload.user || null, credit });
                return;
              }

              sendJson(res, 200, { success: true, user: updatePayload.user || null, credit });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
            }
          });

          server.middlewares.use("/api/local/purchase-minutes", async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, 405, { error: "Method not allowed" });
              return;
            }

            try {
              const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
              const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
              const { userId, purchase_amount, rate_per_minute } = await readJsonBody(req);

              if (!supabaseUrl || !supabaseServiceRoleKey) {
                sendJson(res, 500, { error: "Supabase service role credentials are not configured" });
                return;
              }
              if (!userId || purchase_amount == null) {
                sendJson(res, 400, { error: "userId and purchase_amount are required" });
                return;
              }

              const purchaseAmount = Number(purchase_amount);
              const ratePerMinute = Number(rate_per_minute ?? DEFAULT_RATE_PER_MINUTE);
              const credit = await creditLocalEnterpriseMinutes(
                supabaseUrl,
                supabaseServiceRoleKey,
                userId,
                ratePerMinute,
                purchaseAmount,
              );

              await fetch(`${supabaseUrl}/rest/v1/minute_transactions?user_id=eq.${encodeURIComponent(userId)}&kind=eq.enterprise_credit&amount=eq.${purchaseAmount}&seconds_delta=eq.${credit.creditedSeconds}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  apikey: supabaseServiceRoleKey,
                  Authorization: `Bearer ${supabaseServiceRoleKey}`,
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({
                  kind: "direct_purchase",
                  source: "standard",
                  notes: "Direct plan purchase",
                }),
              });

              sendJson(res, 200, { success: true, credit });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
