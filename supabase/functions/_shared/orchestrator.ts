import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AiProvider = "gemini" | "sarvam";
export type TelephonyProvider = "twilio" | "telnyx";

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-live-001";
const DEFAULT_SARVAM_MODEL = "sarvam-30b";
const DEFAULT_GEMINI_VOICE = "Kore";
const DEFAULT_SARVAM_VOICE = "anushka";

const GEMINI_NATIVE_VOICES = new Set([
  "Kore",
  "Aoede",
  "Leda",
  "Autonoe",
  "Erinome",
  "Laomedeia",
  "Callirrhoe",
  "Despina",
  "Puck",
  "Charon",
  "Fenrir",
  "Orus",
  "Vale",
  "Zephyr",
  "Umbriel",
  "Schedar",
  "Achird",
  "Sadachbia",
  "Sadaltager",
  "Iapetus",
]);

const SARVAM_LANGUAGE_MAP: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  mr: "mr-IN",
  pa: "pa-IN",
  or: "od-IN",
  od: "od-IN",
  ur: "ur-IN",
  "en-IN": "en-IN",
  "hi-IN": "hi-IN",
  "ta-IN": "ta-IN",
  "te-IN": "te-IN",
  "kn-IN": "kn-IN",
  "ml-IN": "ml-IN",
  "bn-IN": "bn-IN",
  "gu-IN": "gu-IN",
  "mr-IN": "mr-IN",
  "pa-IN": "pa-IN",
  "od-IN": "od-IN",
  "ur-IN": "ur-IN",
  unknown: "unknown",
};

const MULAW_DECODE_TABLE = new Int16Array(256);

for (let i = 0; i < 256; i++) {
  let value = ~i & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let magnitude = ((mantissa << 1) + 33) << (exponent + 2);
  magnitude -= 0x84;
  MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
}

export interface OrchestratorEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  geminiApiKey: string;
  sarvamApiKey: string;
}

export interface TelephonyStartContext {
  agentId: string;
  telephonyProvider: TelephonyProvider;
  callAnsweredAt?: string;
  streamSid?: string;
  callSid?: string;
}

export interface AgentRuntime {
  id: string;
  userId: string;
  name: string;
  provider: AiProvider;
  systemPrompt: string;
  model: string;
  voice: string;
  languageHint: string;
  temperature: number;
  firstSpeaker: string;
  maxDurationSeconds: number;
}

export interface UnifiedToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderUiMapping {
  provider: AiProvider;
  model: string;
  modality: "audio";
  voice: string;
  languageCode?: string;
  temperature: number;
  maxDurationSeconds: number;
}

export interface GeminiSessionState {
  provider: "gemini";
  ready: boolean;
  keepAliveIntervalMs: number;
  audioMimeType: "audio/pcm;rate=16000";
  outputAudioMimeType: "audio/pcm;rate=24000";
  pendingGreeting: boolean;
}

export interface SarvamSessionState {
  provider: "sarvam";
  metaPrompt: string;
  languageCode: string;
  shouldSpeakFirst: boolean;
  greetingText: string | null;
  maxDurationSeconds: number;
}

export interface GeminiHandshakeBundle {
  session: GeminiSessionState;
  setupFrame: Record<string, unknown>;
  keepAliveFrame: Record<string, unknown>;
  greetingFrame?: Record<string, unknown>;
}

export interface SarvamHandshakeBundle {
  session: SarvamSessionState;
  metaPrompt: string;
  greetingEvent?: {
    type: "agent_greeting";
    text: string;
  };
}

export interface OrchestratorBootstrapResult {
  runtime: AgentRuntime;
  uiMapping: ProviderUiMapping;
  gemini?: GeminiHandshakeBundle;
  sarvam?: SarvamHandshakeBundle;
}

export async function bootstrapCallOrchestration(
  env: OrchestratorEnv,
  context: TelephonyStartContext,
  tools: UnifiedToolDefinition[] = [],
): Promise<OrchestratorBootstrapResult> {
  const runtime = await loadAgentRuntime(env, context.agentId);
  const uiMapping = mapProviderUiColumns(runtime);

  if (runtime.provider === "gemini") {
    return {
      runtime,
      uiMapping,
      gemini: buildGeminiHandshake(runtime, context, tools),
    };
  }

  return {
    runtime,
    uiMapping,
    sarvam: buildSarvamHandshake(runtime, context),
  };
}

export function mapProviderUiColumns(runtime: AgentRuntime): ProviderUiMapping {
  if (runtime.provider === "gemini") {
    return {
      provider: "gemini",
      model: resolveGeminiModel(runtime.model),
      modality: "audio",
      voice: resolveGeminiVoice(runtime.voice),
      temperature: runtime.temperature,
      maxDurationSeconds: runtime.maxDurationSeconds,
    };
  }

  return {
    provider: "sarvam",
    model: resolveSarvamModel(runtime.model),
    modality: "audio",
    voice: resolveSarvamVoice(runtime.voice),
    languageCode: resolveSarvamLanguage(runtime.languageHint),
    temperature: runtime.temperature,
    maxDurationSeconds: runtime.maxDurationSeconds,
  };
}

export function buildGeminiHandshake(
  runtime: AgentRuntime,
  context: TelephonyStartContext,
  tools: UnifiedToolDefinition[] = [],
): GeminiHandshakeBundle {
  const model = resolveGeminiModel(runtime.model);
  const voice = resolveGeminiVoice(runtime.voice);
  const setupFrame: Record<string, unknown> = {
    setup: {
      model: `models/${model}`,
      systemInstruction: {
        parts: [
          {
            text: buildGeminiSystemInstruction(runtime, context),
          },
        ],
      },
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: runtime.temperature,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
        },
      },
    },
  };

  if (tools.length > 0) {
    (setupFrame.setup as Record<string, unknown>).tools = [{
      functionDeclarations: tools.map(toGeminiFunctionDeclaration),
    }];
  }

  const greetingFrame = shouldAgentSpeakFirst(runtime.firstSpeaker)
    ? {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{
              text:
                `The callee has just answered. Introduce yourself as ${runtime.name} and start the conversation now in one short natural sentence, following the system instruction.`,
            }],
          },
        ],
        turnComplete: true,
      },
    }
    : undefined;

  return {
    session: {
      provider: "gemini",
      ready: false,
      keepAliveIntervalMs: 15000,
      audioMimeType: "audio/pcm;rate=16000",
      outputAudioMimeType: "audio/pcm;rate=24000",
      pendingGreeting: Boolean(greetingFrame),
    },
    setupFrame,
    keepAliveFrame: {
      realtimeInput: {
        mediaChunks: [{
          mimeType: "audio/pcm;rate=16000",
          data: base64Encode(new Uint8Array(640)),
        }],
      },
    },
    greetingFrame,
  };
}

export function buildSarvamHandshake(
  runtime: AgentRuntime,
  _context: TelephonyStartContext,
): SarvamHandshakeBundle {
  const metaPrompt = buildSarvamMetaPrompt(runtime);
  const shouldSpeakFirst = shouldAgentSpeakFirst(runtime.firstSpeaker);

  return {
    session: {
      provider: "sarvam",
      metaPrompt,
      languageCode: resolveSarvamLanguage(runtime.languageHint),
      shouldSpeakFirst,
      greetingText: shouldSpeakFirst
        ? `Hello, this is ${runtime.name}. How can I help you today?`
        : null,
      maxDurationSeconds: runtime.maxDurationSeconds,
    },
    metaPrompt,
    greetingEvent: shouldSpeakFirst
      ? {
        type: "agent_greeting",
        text: `Hello, this is ${runtime.name}. How can I help you today?`,
      }
      : undefined,
  };
}

export function buildGeminiRealtimeInputFrame(mulawPayloadBase64: string) {
  const pcm16k = mulaw8kBase64ToPcm16kBase64(mulawPayloadBase64);
  return {
    realtimeInput: {
      mediaChunks: [{
        mimeType: "audio/pcm;rate=16000",
        data: pcm16k,
      }],
    },
  };
}

export function interpretGeminiServerEvent(event: Record<string, unknown>) {
  return {
    isSetupComplete: Boolean(event.setupComplete),
    isSessionUpdated: "sessionResumptionUpdate" in event || "sessionUpdated" in event,
    shouldKeepOpen: !event.error,
    toolCall: (event.toolCall ?? null) as Record<string, unknown> | null,
    serverContent: (event.serverContent ?? null) as Record<string, unknown> | null,
  };
}

export function buildSarvamChatPayload(
  runtime: AgentRuntime,
  conversation: Array<{ role: string; content: string }>,
) {
  return {
    model: resolveSarvamModel(runtime.model),
    messages: [
      { role: "system", content: buildSarvamMetaPrompt(runtime) },
      { role: "user", content: `Internal call configuration: max_duration_seconds=${runtime.maxDurationSeconds}` },
      { role: "assistant", content: "Understood. I will follow the call instructions and stay within the configured duration." },
      ...conversation,
    ],
    temperature: runtime.temperature,
    max_tokens: 150,
  };
}

export function toGeminiFunctionDeclaration(tool: UnifiedToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "OBJECT",
      properties: tool.parameters,
      required: Object.entries(tool.parameters)
        .filter(([, value]) => Boolean((value as Record<string, unknown>).required))
        .map(([key]) => key),
    },
  };
}

export function toSarvamToolDescriptor(tool: UnifiedToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters,
        required: Object.entries(tool.parameters)
          .filter(([, value]) => Boolean((value as Record<string, unknown>).required))
          .map(([key]) => key),
      },
    },
  };
}

async function loadAgentRuntime(env: OrchestratorEnv, agentId: string): Promise<AgentRuntime> {
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data, error } = await supabase
    .from("agents")
    .select("id,user_id,name,ai_provider,system_prompt,model,voice,language_hint,temperature,first_speaker,max_duration")
    .eq("id", agentId)
    .single();

  if (error || !data) {
    throw new Error(`Failed to load agent runtime for ${agentId}: ${error?.message || "not found"}`);
  }

  const provider = normalizeProvider(String(data.ai_provider || "gemini"));
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name || "MagicTeams AI",
    provider,
    systemPrompt:
      data.system_prompt ||
      "You are a helpful AI assistant on a live phone call. Be concise, natural, and conversational.",
    model: String(data.model || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_SARVAM_MODEL)),
    voice: String(data.voice || (provider === "gemini" ? DEFAULT_GEMINI_VOICE : DEFAULT_SARVAM_VOICE)),
    languageHint: String(data.language_hint || "en-IN"),
    temperature: Number(data.temperature ?? 0.7),
    firstSpeaker: String(data.first_speaker || "FIRST_SPEAKER_AGENT"),
    maxDurationSeconds: Number(data.max_duration ?? 300),
  };
}

function normalizeProvider(value: string): AiProvider {
  return value === "sarvam" ? "sarvam" : "gemini";
}

function resolveGeminiModel(model: string) {
  return model.includes("gemini") ? model : DEFAULT_GEMINI_MODEL;
}

function resolveSarvamModel(model: string) {
  return model.includes("sarvam") ? model : DEFAULT_SARVAM_MODEL;
}

function resolveGeminiVoice(voice: string) {
  return GEMINI_NATIVE_VOICES.has(voice) ? voice : DEFAULT_GEMINI_VOICE;
}

function resolveSarvamVoice(voice: string) {
  return voice || DEFAULT_SARVAM_VOICE;
}

function resolveSarvamLanguage(languageHint: string) {
  return SARVAM_LANGUAGE_MAP[languageHint] ||
    SARVAM_LANGUAGE_MAP[languageHint.split("-")[0]] ||
    "en-IN";
}

function shouldAgentSpeakFirst(firstSpeaker: string) {
  return firstSpeaker === "FIRST_SPEAKER_AGENT" || firstSpeaker === "agent";
}

function buildGeminiSystemInstruction(runtime: AgentRuntime, context: TelephonyStartContext) {
  return [
    runtime.systemPrompt,
    "",
    "Call mode: live telephony audio session.",
    `Agent name: ${runtime.name}.`,
    `Telephony provider: ${context.telephonyProvider}.`,
    `First speaker policy: ${runtime.firstSpeaker}.`,
    `Maximum call duration: ${runtime.maxDurationSeconds} seconds.`,
    "Speak naturally in short phone-friendly sentences.",
    "Do not use markdown, bullet points, or formatting.",
  ].join("\n");
}

function buildSarvamMetaPrompt(runtime: AgentRuntime) {
  return [
    runtime.systemPrompt,
    "",
    `Agent name: ${runtime.name}.`,
    `Language code: ${resolveSarvamLanguage(runtime.languageHint)}.`,
    `First speaker policy: ${runtime.firstSpeaker}.`,
    `Maximum call duration: ${runtime.maxDurationSeconds} seconds.`,
    "You are on a live phone call.",
    "Respond in 1-2 short natural sentences.",
    "Do not use markdown or lists.",
  ].join("\n");
}

function mulaw8kBase64ToPcm16kBase64(b64: string) {
  const muLaw = base64Decode(b64);
  const pcm16k = mulawToPcm16k(muLaw);
  return base64Encode(pcm16k);
}

function mulawToPcm16k(muLaw: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(muLaw.length * 4);
  const view = new DataView(buffer);

  for (let i = 0; i < muLaw.length; i++) {
    const current = MULAW_DECODE_TABLE[muLaw[i]];
    const next = i + 1 < muLaw.length ? MULAW_DECODE_TABLE[muLaw[i + 1]] : current;
    view.setInt16(i * 4, current, true);
    view.setInt16(i * 4 + 2, Math.round((current + next) / 2), true);
  }

  return new Uint8Array(buffer);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
