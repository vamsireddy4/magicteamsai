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
                sendJson(res, callResponse.status, {
                  error: callData?.message || callData?.error || "Failed to fetch Ultravox call",
                  details: callData,
                });
                return;
              }

              if (!messagesResponse.ok) {
                sendJson(res, messagesResponse.status, {
                  error: messagesData?.message || messagesData?.error || "Failed to fetch Ultravox transcript",
                  details: messagesData,
                });
                return;
              }

              sendJson(res, 200, normalizeUltravoxCallData(callData, messagesData));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sendJson(res, 500, { error: message });
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
              } = await readJsonBody(req);

              if (!agent || !phoneConfig || !recipientNumber) {
                sendJson(res, 400, { error: "agent, phoneConfig, and recipientNumber are required" });
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
