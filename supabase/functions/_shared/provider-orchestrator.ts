import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SARVAM_CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_SARVAM_MODEL = "sarvam-30b";

export interface RuntimeContext {
  supabaseUrl: string;
  supabaseServiceKey: string;
  geminiApiKey: string;
  sarvamApiKey: string;
  ultravoxApiKey: string;
}

export interface RuntimeDependencies {
  env: RuntimeContext;
  supabase: ReturnType<typeof createClient>;
}

export interface ProviderOrchestrationRequest {
  provider?: "gemini" | "sarvam" | "ultravox";
  agent_id: string;
  messages?: ConversationMessage[];
  query?: string;
  call_context?: Record<string, unknown>;
  state?: ProviderSessionState;
}

export interface ProviderSessionState {
  provider: "gemini" | "sarvam" | "ultravox";
  agent_id: string;
  user_id: string;
  tool_history: ToolExecutionTrace[];
  rag_context: RagSnippet[];
  conversation: ConversationMessage[];
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
}

export interface ToolExecutionTrace {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  executed_at: string;
}

interface AgentRecord {
  id: string;
  user_id: string;
  name: string;
  ai_provider: string;
  system_prompt: string;
  model: string;
  voice: string;
  temperature: number;
  language_hint: string | null;
  first_speaker: string;
  max_duration: number | null;
}

interface AgentToolRecord {
  id: string;
  name: string;
  description: string;
  http_method: string;
  http_url: string;
  http_headers: Record<string, string> | null;
  http_body_template: Record<string, unknown> | null;
  parameters: ToolParameter[] | null;
  is_active: boolean;
}

interface ToolParameter {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
  location?: "body" | "query" | "header" | string;
  paramType?: "automatic" | "dynamic" | string;
  knownValue?: string;
  schema?: Record<string, unknown>;
}

interface AppointmentToolRecord {
  id: string;
  name: string;
  provider: string;
  business_hours: Record<string, unknown>;
  appointment_types: Array<Record<string, unknown>>;
  calendar_integration_id: string | null;
  calendar_integrations?: CalendarIntegrationRecord | null;
}

interface CalendarIntegrationRecord {
  id: string;
  provider: string;
  api_key: string | null;
  calendar_id: string | null;
  config: Record<string, unknown> | null;
  is_active: boolean;
}

interface KnowledgeItemRecord {
  id: string;
  title: string;
  content: string | null;
  website_url: string | null;
  type: string;
  processing_status: string | null;
}

interface ForwardingNumberRecord {
  id: string;
  phone_number: string;
  label: string | null;
  priority: number;
}

interface WebhookRecord {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  is_active: boolean;
}

interface AgentRuntime {
  agent: AgentRecord;
  tools: AgentToolRecord[];
  appointmentTools: AppointmentToolRecord[];
  forwardingNumbers: ForwardingNumberRecord[];
  knowledgeItems: KnowledgeItemRecord[];
  webhooks: WebhookRecord[];
}

interface RagSnippet {
  id: string;
  title: string;
  score: number;
  excerpt: string;
  source: "content" | "website";
}

interface UnifiedToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: "custom_http" | "appointment_check" | "appointment_book" | "transfer" | "webhook";
  meta?: Record<string, unknown>;
}

interface ToolDispatchResult {
  ok: boolean;
  data: unknown;
}

export async function createRuntimeDependencies(): Promise<RuntimeDependencies> {
  const env = {
    supabaseUrl: requiredEnv("SUPABASE_URL"),
    supabaseServiceKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    geminiApiKey: requiredEnv("GEMINI_API_KEY"),
    sarvamApiKey: requiredEnv("SARVAM_API_KEY"),
    ultravoxApiKey: Deno.env.get("ULTRAVOX_API_KEY") || "",
  };

  return {
    env,
    supabase: createClient(env.supabaseUrl, env.supabaseServiceKey),
  };
}

export async function handleProviderTurn(
  deps: RuntimeDependencies,
  request: ProviderOrchestrationRequest,
): Promise<{
  provider: "gemini" | "sarvam" | "ultravox";
  response: string;
  state: ProviderSessionState;
  tools: {
    unified: UnifiedToolDefinition[];
    gemini: Record<string, unknown>[];
    sarvam: Array<Record<string, unknown>>;
  };
}> {
  const runtime = await loadAgentRuntime(deps, request.agent_id);
  const provider = resolveProvider(request.provider, runtime.agent.ai_provider);
  const latestUserText = request.query || [...(request.messages || [])].reverse().find((m) => m.role === "user")?.content || "";
  const ragContext = buildRagContext(latestUserText, runtime.knowledgeItems);
  const unifiedTools = buildUnifiedTools(runtime);
  const systemPrompt = buildSystemPrompt(runtime, ragContext);

  const priorState = request.state;
  const conversation = normalizeConversation(request.messages, priorState?.conversation);
  const state: ProviderSessionState = {
    provider,
    agent_id: runtime.agent.id,
    user_id: runtime.agent.user_id,
    tool_history: priorState?.tool_history || [],
    rag_context: ragContext,
    conversation,
  };

  let response = "";
  if (provider === "gemini") {
    response = await runGeminiTurn(deps, runtime, systemPrompt, state, unifiedTools);
  } else if (provider === "sarvam") {
    response = await runSarvamTurn(deps, runtime, systemPrompt, state, unifiedTools);
  } else {
    response = "Ultravox continues to use its native runtime. This orchestrator is intended for Gemini and Sarvam parity.";
  }

  state.conversation = appendConversation(state.conversation, [
    { role: "assistant", content: response },
  ]);

  return {
    provider,
    response,
    state,
    tools: {
      unified: unifiedTools,
      gemini: unifiedTools.map(toGeminiFunctionDeclaration),
      sarvam: unifiedTools.map(toSarvamToolDescriptor),
    },
  };
}

export async function bootstrapProviderRuntime(
  deps: RuntimeDependencies,
  request: ProviderOrchestrationRequest,
): Promise<{
  provider: "gemini" | "sarvam" | "ultravox";
  state: ProviderSessionState;
  system_prompt: string;
  tools: {
    unified: UnifiedToolDefinition[];
    gemini: Record<string, unknown>[];
    sarvam: Array<Record<string, unknown>>;
  };
}> {
  const runtime = await loadAgentRuntime(deps, request.agent_id);
  const provider = resolveProvider(request.provider, runtime.agent.ai_provider);
  const latestUserText = request.query || [...(request.messages || [])].reverse().find((m) => m.role === "user")?.content || "";
  const ragContext = buildRagContext(latestUserText, runtime.knowledgeItems);
  const unifiedTools = buildUnifiedTools(runtime);
  const systemPrompt = buildSystemPrompt(runtime, ragContext);

  return {
    provider,
    state: {
      provider,
      agent_id: runtime.agent.id,
      user_id: runtime.agent.user_id,
      tool_history: request.state?.tool_history || [],
      rag_context: ragContext,
      conversation: normalizeConversation(request.messages, request.state?.conversation),
    },
    system_prompt: systemPrompt,
    tools: {
      unified: unifiedTools,
      gemini: unifiedTools.map(toGeminiFunctionDeclaration),
      sarvam: unifiedTools.map(toSarvamToolDescriptor),
    },
  };
}

export async function dispatchProviderTool(
  deps: RuntimeDependencies,
  request: ProviderOrchestrationRequest,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  const runtime = await loadAgentRuntime(deps, request.agent_id);
  const tools = buildUnifiedTools(runtime);
  return await dispatchToolCall(deps, runtime, tools, toolName, args, request.call_context || {});
}

async function loadAgentRuntime(deps: RuntimeDependencies, agentId: string): Promise<AgentRuntime> {
  const { supabase } = deps;

  const [
    { data: agent, error: agentError },
    { data: tools, error: toolsError },
    { data: appointmentTools, error: appointmentToolsError },
    { data: knowledgeItems, error: knowledgeError },
    { data: forwardingNumbers, error: forwardingError },
    { data: webhooks, error: webhooksError },
  ] = await Promise.all([
    supabase.from("agents").select("*").eq("id", agentId).single(),
    supabase.from("agent_tools").select("*").eq("agent_id", agentId).eq("is_active", true),
    supabase.from("appointment_tools").select("*, calendar_integrations(*)").eq("agent_id", agentId).eq("is_active", true),
    supabase.from("knowledge_base_items").select("*").eq("agent_id", agentId),
    supabase.from("call_forwarding_numbers").select("*").eq("agent_id", agentId).order("priority", { ascending: true }),
    supabase.from("webhooks").select("*").eq("agent_id", agentId).eq("is_active", true),
  ]);

  if (agentError || !agent) throw new Error(`Failed to load agent ${agentId}: ${agentError?.message || "not found"}`);
  if (toolsError) throw new Error(`Failed to load agent tools: ${toolsError.message}`);
  if (appointmentToolsError) throw new Error(`Failed to load appointment tools: ${appointmentToolsError.message}`);
  if (knowledgeError) throw new Error(`Failed to load knowledge base: ${knowledgeError.message}`);
  if (forwardingError) throw new Error(`Failed to load forwarding numbers: ${forwardingError.message}`);
  if (webhooksError) throw new Error(`Failed to load webhooks: ${webhooksError.message}`);

  return {
    agent: agent as AgentRecord,
    tools: ((tools || []) as AgentToolRecord[]).map(normalizeAgentTool),
    appointmentTools: (appointmentTools || []) as AppointmentToolRecord[],
    forwardingNumbers: (forwardingNumbers || []) as ForwardingNumberRecord[],
    knowledgeItems: (knowledgeItems || []) as KnowledgeItemRecord[],
    webhooks: (webhooks || []) as WebhookRecord[],
  };
}

function normalizeAgentTool(tool: AgentToolRecord): AgentToolRecord {
  return {
    ...tool,
    http_headers: asRecord(tool.http_headers),
    http_body_template: asRecord(tool.http_body_template),
    parameters: Array.isArray(tool.parameters) ? tool.parameters : [],
  };
}

function buildRagContext(query: string, knowledgeItems: KnowledgeItemRecord[]): RagSnippet[] {
  const normalizedQuery = tokenize(query);
  if (!normalizedQuery.length) {
    return knowledgeItems
      .filter((item) => item.content || item.website_url)
      .slice(0, 3)
      .map((item, index) => ({
        id: item.id,
        title: item.title,
        score: 0.1 - index * 0.01,
        excerpt: summarizeKnowledgeItem(item),
        source: item.content ? "content" : "website",
      }));
  }

  return knowledgeItems
    .filter((item) => item.content || item.website_url)
    .map((item) => {
      const haystack = `${item.title}\n${item.content || ""}\n${item.website_url || ""}`.toLowerCase();
      let score = 0;
      for (const token of normalizedQuery) {
        if (haystack.includes(token)) score += token.length > 4 ? 3 : 1;
      }
      return {
        id: item.id,
        title: item.title,
        score,
        excerpt: summarizeKnowledgeItem(item),
        source: item.content ? "content" : "website" as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function summarizeKnowledgeItem(item: KnowledgeItemRecord): string {
  if (item.content) return item.content.slice(0, 1200);
  return `Reference website: ${item.website_url}`;
}

function buildSystemPrompt(runtime: AgentRuntime, ragContext: RagSnippet[]): string {
  const now = new Date().toISOString();
  const lines: string[] = [
    runtime.agent.system_prompt || "You are a voice assistant handling a phone conversation.",
    "",
    `Current UTC timestamp: ${now}`,
    `Agent name: ${runtime.agent.name}`,
    `Language hint: ${runtime.agent.language_hint || "en"}`,
    `Voice: ${runtime.agent.voice}`,
    `Max call duration: ${runtime.agent.max_duration || 300} seconds`,
    `First speaker: ${runtime.agent.first_speaker || "agent"}`,
  ];

  if (ragContext.length > 0) {
    lines.push("", "--- KNOWLEDGE CONTEXT ---");
    for (const snippet of ragContext) {
      lines.push(`## ${snippet.title}`);
      lines.push(snippet.excerpt);
    }
  }

  if (runtime.appointmentTools.length > 0) {
    lines.push("", "--- APPOINTMENT TOOLS ---");
    for (const tool of runtime.appointmentTools) {
      const types = Array.isArray(tool.appointment_types)
        ? tool.appointment_types.map((value: any) => value?.name || JSON.stringify(value)).join(", ")
        : "default";
      lines.push(`${tool.name}: provider=${tool.provider}; types=${types}`);
    }
  }

  if (runtime.forwardingNumbers.length > 0) {
    lines.push("", "--- CALL FORWARDING ---");
    lines.push(
      `When the caller requests a human handoff, use transfer_call. Available numbers: ${runtime.forwardingNumbers.map((entry) => `${entry.phone_number}${entry.label ? ` (${entry.label})` : ""}`).join(", ")}`
    );
  }

  if (runtime.webhooks.length > 0) {
    lines.push("", "--- WEBHOOKS ---");
    lines.push(`You may trigger named webhooks via trigger_webhook. Available hooks: ${runtime.webhooks.map((hook) => hook.name).join(", ")}`);
  }

  lines.push("", "Keep spoken responses concise and natural. Never expose tool syntax to the caller.");
  return lines.join("\n");
}

function buildUnifiedTools(runtime: AgentRuntime): UnifiedToolDefinition[] {
  const tools: UnifiedToolDefinition[] = [];

  for (const tool of runtime.tools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      kind: "custom_http",
      parameters: toJsonSchema(tool.parameters || []),
      meta: { toolId: tool.id },
    });
  }

  for (const tool of runtime.appointmentTools) {
    const suffix = slug(tool.name);
    tools.push({
      name: `check_availability_${suffix}`,
      description: `Check calendar availability for ${tool.name}.`,
      kind: "appointment_check",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Target date in YYYY-MM-DD format" },
          duration_minutes: { type: "number", description: "Desired appointment duration in minutes" },
        },
        required: ["date"],
      },
      meta: { appointmentToolId: tool.id },
    });
    tools.push({
      name: `book_appointment_${suffix}`,
      description: `Book an appointment with ${tool.name}.`,
      kind: "appointment_book",
      parameters: {
        type: "object",
        properties: {
          start_time: { type: "string", description: "ISO timestamp for appointment start" },
          end_time: { type: "string", description: "ISO timestamp for appointment end" },
          attendee_name: { type: "string" },
          attendee_email: { type: "string" },
          attendee_phone: { type: "string" },
          notes: { type: "string" },
        },
        required: ["start_time", "attendee_name"],
      },
      meta: { appointmentToolId: tool.id },
    });
  }

  if (runtime.forwardingNumbers.length > 0) {
    tools.push({
      name: "transfer_call",
      description: "Transfer the live call to a configured human forwarding destination.",
      kind: "transfer",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Optional reason for the transfer." },
        },
      },
    });
  }

  if (runtime.webhooks.length > 0) {
    tools.push({
      name: "trigger_webhook",
      description: "Trigger one of the configured business webhooks by name.",
      kind: "webhook",
      parameters: {
        type: "object",
        properties: {
          webhook_name: { type: "string", description: "Configured webhook name to trigger." },
          event: { type: "string", description: "Business event name to emit." },
          payload: { type: "object", description: "Arbitrary JSON payload for the webhook." },
        },
        required: ["webhook_name"],
      },
    });
  }

  return tools;
}

function toJsonSchema(parameters: ToolParameter[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const parameter of parameters.filter((entry) => entry.paramType !== "automatic")) {
    properties[parameter.name] = parameter.schema || {
      type: parameter.type || "string",
      description: parameter.description || "",
    };
    if (parameter.required) required.push(parameter.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function toGeminiFunctionDeclaration(tool: UnifiedToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function toSarvamToolDescriptor(tool: UnifiedToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

async function runGeminiTurn(
  deps: RuntimeDependencies,
  runtime: AgentRuntime,
  systemPrompt: string,
  state: ProviderSessionState,
  tools: UnifiedToolDefinition[],
): Promise<string> {
  const model = runtime.agent.model?.includes("gemini") ? runtime.agent.model : DEFAULT_GEMINI_MODEL;
  let contents = toGeminiContents(state.conversation);

  for (let iteration = 0; iteration < 4; iteration++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${deps.env.geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: tools.length ? [{ functionDeclarations: tools.map(toGeminiFunctionDeclaration) }] : undefined,
          generationConfig: {
            temperature: runtime.agent.temperature ?? 0.2,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini generateContent failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCallPart = parts.find((part: any) => part.functionCall);

    if (functionCallPart?.functionCall) {
      const name = functionCallPart.functionCall.name;
      const args = functionCallPart.functionCall.args || {};
      const result = await dispatchToolCall(deps, runtime, tools, name, args, {});
      state.tool_history.push({ tool: name, args, result, executed_at: new Date().toISOString() });
      state.conversation = appendConversation(state.conversation, [
        { role: "assistant", content: `[tool_use:${name}]` },
        { role: "tool", tool_name: name, content: JSON.stringify(result.data) },
      ]);
      contents = toGeminiContents(state.conversation);
      continue;
    }

    const text = parts.map((part: any) => part.text || "").join("").trim();
    return text || "I’m sorry, could you repeat that?";
  }

  throw new Error("Gemini exceeded tool loop limit");
}

async function runSarvamTurn(
  deps: RuntimeDependencies,
  runtime: AgentRuntime,
  systemPrompt: string,
  state: ProviderSessionState,
  tools: UnifiedToolDefinition[],
): Promise<string> {
  let messages = [
    {
      role: "system",
      content: `${systemPrompt}

You may respond in one of two JSON forms only:
{"type":"assistant","content":"spoken reply"}
{"type":"tool_use","tool":"tool_name","arguments":{...}}

Available tools:
${tools.map((tool) => `- ${tool.name}: ${tool.description}; schema=${JSON.stringify(tool.parameters)}`).join("\n")}
`,
    },
    ...state.conversation.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.content })),
  ];

  for (let iteration = 0; iteration < 4; iteration++) {
    const response = await fetch(SARVAM_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": deps.env.sarvamApiKey,
      },
      body: JSON.stringify({
        model: runtime.agent.model || DEFAULT_SARVAM_MODEL,
        messages,
        temperature: runtime.agent.temperature ?? 0.2,
        max_tokens: 250,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sarvam chat failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = parseSarvamPayload(rawContent);

    if (parsed?.type === "tool_use") {
      const result = await dispatchToolCall(deps, runtime, tools, parsed.tool, parsed.arguments || {}, {});
      state.tool_history.push({ tool: parsed.tool, args: parsed.arguments || {}, result, executed_at: new Date().toISOString() });
      state.conversation = appendConversation(state.conversation, [
        { role: "assistant", content: `[tool_use:${parsed.tool}]` },
        { role: "tool", tool_name: parsed.tool, content: JSON.stringify(result.data) },
      ]);
      messages = [
        messages[0],
        ...state.conversation.map((message) => ({ role: message.role === "tool" ? "user" : message.role, content: message.content })),
      ];
      continue;
    }

    if (parsed?.type === "assistant" && parsed.content) {
      return parsed.content;
    }

    return rawContent.replace(/\s+/g, " ").trim() || "I’m sorry, could you repeat that?";
  }

  throw new Error("Sarvam exceeded tool loop limit");
}

async function dispatchToolCall(
  deps: RuntimeDependencies,
  runtime: AgentRuntime,
  tools: UnifiedToolDefinition[],
  toolName: string,
  args: Record<string, unknown>,
  callContext: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  const tool = tools.find((entry) => entry.name === toolName);
  if (!tool) return { ok: false, data: { error: `Unknown tool: ${toolName}` } };

  if (tool.kind === "appointment_check") {
    const appointmentTool = runtime.appointmentTools.find((entry) => tool.meta?.appointmentToolId === entry.id);
    const integration = appointmentTool?.calendar_integrations;
    if (!appointmentTool || !integration?.id) {
      return { ok: false, data: { error: "Appointment integration not configured" } };
    }

    const result = await invokeInternalEdge(
      deps,
      "check-calendar-availability",
      {
        provider: appointmentTool.provider || integration.provider,
        integration_id: integration.id,
        date: args.date,
        duration_minutes: args.duration_minutes || 30,
      },
    );
    return { ok: true, data: result };
  }

  if (tool.kind === "appointment_book") {
    const appointmentTool = runtime.appointmentTools.find((entry) => tool.meta?.appointmentToolId === entry.id);
    const integration = appointmentTool?.calendar_integrations;
    if (!appointmentTool || !integration?.id) {
      return { ok: false, data: { error: "Appointment integration not configured" } };
    }

    const result = await invokeInternalEdge(
      deps,
      "book-calendar-appointment",
      {
        provider: appointmentTool.provider || integration.provider,
        integration_id: integration.id,
        ...args,
      },
    );
    return { ok: true, data: result };
  }

  if (tool.kind === "transfer") {
    const result = await invokeInternalEdge(
      deps,
      "transfer-call",
      {
        call_sid: String(callContext.call_sid || ""),
        agent_id: runtime.agent.id,
        provider: callContext.provider || "twilio",
      },
    );
    return { ok: true, data: result };
  }

  if (tool.kind === "webhook") {
    const webhookName = String(args.webhook_name || "");
    const webhook = runtime.webhooks.find((entry) => entry.name === webhookName);
    if (!webhook) {
      return { ok: false, data: { error: `Webhook not found: ${webhookName}` } };
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhook.secret) headers["X-Webhook-Secret"] = webhook.secret;
    const payload = {
      event: args.event || "manual.triggered",
      timestamp: new Date().toISOString(),
      agent_id: runtime.agent.id,
      user_id: runtime.agent.user_id,
      payload: args.payload || {},
    };

    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await response.text();
    return {
      ok: response.ok,
      data: {
        status: response.status,
        response: data,
      },
    };
  }

  return await executeCustomHttpTool(runtime, toolName, args, callContext);
}

async function executeCustomHttpTool(
  runtime: AgentRuntime,
  toolName: string,
  args: Record<string, unknown>,
  callContext: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  const tool = runtime.tools.find((entry) => entry.name === toolName);
  if (!tool) return { ok: false, data: { error: `Custom tool not found: ${toolName}` } };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(tool.http_headers || {}),
  };

  const mergedArgs = { ...args };
  for (const parameter of tool.parameters || []) {
    if (parameter.paramType !== "automatic") continue;
    if (parameter.knownValue === "call.id") mergedArgs[parameter.name] = callContext.call_sid || "";
    if (parameter.knownValue === "call.conversation_history") mergedArgs[parameter.name] = callContext.conversation || [];
  }

  let url = tool.http_url;
  const query = new URLSearchParams();
  const bodyPayload = { ...(tool.http_body_template || {}) };
  delete (bodyPayload as Record<string, unknown>).__agentEndBehavior;
  delete (bodyPayload as Record<string, unknown>).__staticResponse;

  for (const parameter of tool.parameters || []) {
    const value = mergedArgs[parameter.name];
    if (value === undefined) continue;

    const location = parameter.location || "body";
    if (location === "query") query.set(parameter.name, String(value));
    else if (location === "header") headers[parameter.name] = String(value);
    else (bodyPayload as Record<string, unknown>)[parameter.name] = value;
  }

  for (const [key, value] of Object.entries(mergedArgs)) {
    url = url.replace(`{{${key}}}`, encodeURIComponent(String(value)));
  }
  const queryString = query.toString();
  if (queryString) {
    url += url.includes("?") ? `&${queryString}` : `?${queryString}`;
  }

  const response = await fetch(url, {
    method: tool.http_method || "POST",
    headers,
    body: tool.http_method === "GET" ? undefined : JSON.stringify(bodyPayload),
  });
  const data = await response.text();
  return {
    ok: response.ok,
    data: safeJsonParse(data),
  };
}

async function invokeInternalEdge(
  deps: RuntimeDependencies,
  slug: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${deps.env.supabaseUrl}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deps.env.supabaseServiceKey}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return safeJsonParse(text);
}

function parseSarvamPayload(raw: string): { type: "assistant"; content: string } | { type: "tool_use"; tool: string; arguments: Record<string, unknown> } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.type === "assistant" && typeof parsed.content === "string") {
      return { type: "assistant", content: parsed.content };
    }
    if (parsed?.type === "tool_use" && typeof parsed.tool === "string") {
      return { type: "tool_use", tool: parsed.tool, arguments: parsed.arguments || {} };
    }
  } catch {
    return null;
  }
  return null;
}

function toGeminiContents(messages: ConversationMessage[]): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return {
          role: "user",
          parts: [{
            functionResponse: {
              name: message.tool_name,
              response: safeJsonParse(message.content),
            },
          }],
        };
      }

      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      };
    });
}

function normalizeConversation(
  messages?: ConversationMessage[],
  previous?: ConversationMessage[],
): ConversationMessage[] {
  if (messages?.length) return messages;
  return previous?.length ? previous : [];
}

function appendConversation(
  current: ConversationMessage[],
  additions: ConversationMessage[],
): ConversationMessage[] {
  return [...current, ...additions].slice(-30);
}

function resolveProvider(requested: string | undefined, stored: string): "gemini" | "sarvam" | "ultravox" {
  const provider = (requested || stored || "ultravox").toLowerCase();
  if (provider.includes("gemini")) return "gemini";
  if (provider.includes("sarvam")) return "sarvam";
  return "ultravox";
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length >= 3);
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}
