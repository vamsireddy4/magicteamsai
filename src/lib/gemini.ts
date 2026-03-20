export interface GeminiColumnDef {
  key: string;
  label: string;
  type: "text" | "phone" | "date" | "number" | "email";
}

export interface GeminiCsvAnalysis {
  columns: GeminiColumnDef[];
  rows: Record<string, string>[];
  summary: string;
  totalRows: number;
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";

function getEffectiveApiKey(userApiKey?: string | null) {
  const key = userApiKey?.trim() || GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("Gemini API Key is not set. Please go to Settings and save your Gemini API key.");
  }
  return key;
}

function parseGeminiJsonResponse(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed);
}

function sanitizeAnalysis(parsed: any, totalRows: number): GeminiCsvAnalysis {
  const columns = Array.isArray(parsed?.columns) ? parsed.columns : [];
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const summary = typeof parsed?.summary === "string" ? parsed.summary : "";

  return {
    columns: columns.map((column: any) => ({
      key: String(column?.key || ""),
      label: String(column?.label || column?.key || ""),
      type: ["text", "phone", "date", "number", "email"].includes(column?.type) ? column.type : "text",
    })).filter((column: GeminiColumnDef) => column.key),
    rows: rows
      .filter((row: any) => row && typeof row === "object" && !Array.isArray(row))
      .map((row: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value).trim()])
        )
      ),
    summary,
    totalRows,
  };
}

export async function analyzeCsvWithGemini(csvContent: string, userApiKey?: string | null, analysisModel?: string | null): Promise<GeminiCsvAnalysis> {
  const apiKey = getEffectiveApiKey(userApiKey);
  const modelStr = analysisModel || "gemini";
  const lines = csvContent.trim().split("\n");
  const preview = lines.slice(0, Math.min(lines.length, 201)).join("\n");
  const totalRows = Math.max(lines.length - 1, 0);

  const prompt = `You are a CSV data analyst. Analyze this CSV data and return ONLY valid JSON.

The CSV has ${totalRows} total data rows. Here is the data (header + up to 200 rows):

${preview}

Return JSON with this exact structure:
{
  "columns": [
    {
      "key": "original_csv_header_name",
      "label": "Human Readable Label",
      "type": "text|phone|date|number|email"
    }
  ],
  "rows": [
    { "original_csv_header_1": "value1", "original_csv_header_2": "value2" }
  ],
  "summary": "Brief one-line summary of what this data contains"
}

Rules:
- Include all CSV columns.
- Detect phone, date, number, and email columns accurately.
- Clean values by trimming whitespace.
- STRONGLY ENFORCED: ALWAYS convert phone numbers to full international E.164 format (e.g., +919441156873). If a number is missing a country code, you MUST intelligently imply its country code from the names/emails/context (default to +91 or +1 if obvious). DO NOT leave 10-digit numbers without a '+' and country code.
- Remove completely empty rows.
- Deduplicate rows with the same phone number when possible.
- Keep up to 200 analyzed rows.`;

  let text = "";

  if (modelStr === "gemini") {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Gemini analysis failed");
    text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";
    if (!text) throw new Error("Gemini returned an empty response");
  } else {
    let endpoint = "";
    let apiModel = "";
    let apiKeyToUse = apiKey;
    
    if (modelStr === "perplexity") {
      endpoint = "https://api.perplexity.ai/chat/completions";
      apiModel = "sonar";
    } else if (modelStr === "grok") {
      endpoint = "https://api.x.ai/v1/chat/completions";
      apiModel = "grok-beta";
    } else if (modelStr === "chatgpt") {
      endpoint = "https://api.openai.com/v1/chat/completions";
      apiModel = "gpt-4o-mini";
    } else if (modelStr === "deepseek") {
      endpoint = "https://api.deepseek.com/chat/completions";
      apiModel = "deepseek-chat";
    } else if (modelStr === "cloudflare") {
      endpoint = "https://corsproxy.io/?" + encodeURIComponent("https://api.cloudflare.com/client/v4/accounts/a54b12fe3ef06df16ff0041d79c18fc0/ai/v1/chat/completions");
      apiModel = "@cf/nvidia/nemotron-3-120b-a12b";
    }

    const payload: any = {
      model: apiModel,
      messages: [{ role: "user", content: prompt }]
    };

    if (modelStr !== "perplexity") {
      payload.temperature = 0.1;
    }
    
    if (modelStr === "chatgpt") {
      payload.response_format = { type: "json_object" };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKeyToUse}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `${modelStr} analysis failed`);
    text = data?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error(`${modelStr} returned an empty response`);
  }

  const parsed = parseGeminiJsonResponse(text);
  return sanitizeAnalysis(parsed, totalRows);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function extractKnowledgeFromFileWithGemini(file: File, userApiKey?: string | null) {
  const apiKey = getEffectiveApiKey(userApiKey);
  const isTextLike = /(?:text\/.*|application\/json)/i.test(file.type) || /\.(txt|md|csv)$/i.test(file.name);

  let parts: any[];
  if (isTextLike) {
    const text = await file.text();
    parts = [{
      text: `You are a knowledge extraction assistant. Extract and structure ALL useful information from the following file content into clean plain text for an AI phone agent. Preserve important facts, policies, pricing, contact info, services, procedures, and FAQs.\n\n${text.slice(0, 50000)}`,
    }];
  } else {
    const base64Data = arrayBufferToBase64(await file.arrayBuffer());
    parts = [
      { text: "Extract and structure ALL useful information from this file into clean plain text for an AI phone agent. Preserve important facts, policies, pricing, contact info, services, procedures, and FAQs." },
      {
        inlineData: {
          mimeType: file.type || "application/octet-stream",
          data: base64Data,
        },
      },
    ];
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini file extraction failed");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("").trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty extracted content");
  }

  return text;
}

export async function extractKnowledgeFromUrlWithGemini(url: string, existingDescription?: string | null, userApiKey?: string | null) {
  const apiKey = getEffectiveApiKey(userApiKey);
  const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const sourceResponse = await fetch(`https://r.jina.ai/http://${normalizedUrl.replace(/^https?:\/\//i, "")}`);
  if (!sourceResponse.ok) {
    throw new Error(`Failed to fetch website content (${sourceResponse.status})`);
  }

  const sourceText = (await sourceResponse.text()).trim();
  if (!sourceText) {
    throw new Error("Website content was empty");
  }

  const prompt = `You are a knowledge extraction assistant. Extract and structure ALL useful information from the following website content into clean plain text for an AI phone agent.

Preserve important facts, policies, pricing, contact info, services, procedures, FAQs, hours, addresses, and business rules.
${existingDescription?.trim() ? `\nAdditional context from the user:\n${existingDescription.trim()}\n` : ""}

Website URL: ${normalizedUrl}

Website content:
${sourceText.slice(0, 120000)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini website extraction failed");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("").trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty extracted website content");
  }

  return text;
}

export async function summarizeCallTranscriptWithGemini(params: {
  transcript: string;
  direction?: string | null;
  agentName?: string | null;
  durationSeconds?: number | null;
  phoneNumber?: string | null;
}, userApiKey?: string | null) {
  const apiKey = getEffectiveApiKey(userApiKey);
  const prompt = `You are an expert call analyst. Produce a concise operational summary for this phone call.

Return plain text with:
1. Purpose: one sentence
2. Key points: 2-4 short bullet points
3. Outcome: one short sentence
4. Action items: one short sentence or "None"
5. Sentiment: positive, neutral, or negative

Call details:
- Direction: ${params.direction || "unknown"}
- Agent: ${params.agentName || "Unknown"}
- Duration: ${params.durationSeconds != null ? `${Math.floor(params.durationSeconds / 60)}m ${params.durationSeconds % 60}s` : "Unknown"}
- Phone: ${params.phoneNumber || "Unknown"}

Transcript:
${params.transcript}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini call summarization failed");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("").trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty summary");
  }

  return text;
}

export async function enhanceAgentPrompt(params: {
  industry: string;
  strategy: string;
  description: string;
}, userApiKey?: string | null) {
  const apiKey = getEffectiveApiKey(userApiKey);
  const prompt = `You are an expert AI prompt engineer. 
Industry: ${params.industry}
Agent Type: ${params.strategy}
User request for agent personality/behavior: "${params.description}"

Task: Write a comprehensive, professional system prompt for this AI voice/text agent. 
Include:
1. A clear Persona and Role
2. Specific behavioral guidelines (tone, style)
3. Main objectives based on the industry and strategy
4. Constraints (keep it concise, professional)

Format the response as a single, well-structured paragraph that can be used as a system prompt. Do not include any meta-commentary, just the prompt itself.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini enhancement failed");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("").trim() || "";
  if (!text) {
    throw new Error("Gemini returned empty enhanced prompt");
  }

  return text;
}
