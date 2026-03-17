import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { name, context, description, userGeminiKey } = await req.json();
    
    // Priority: 1. User specified key from profile 2. System env var
    const geminiKey = userGeminiKey || Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not found. Please set it in your Profile or contact support." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prompt = `You are an expert at writing system prompts for AI voice agents.
Create a highly detailed and effective system prompt for a voice agent with the following details:
- Agent Name: ${name}
- Industry/Context: ${context || "General"}
- Primary Task/Description: ${description || "Be a helpful assistant"}

The system prompt must be optimized for voice-to-voice interaction. 
Include:
1. Role & Persona: Define exactly who the agent is and their speaking style (concise, professional, friendly).
2. Objectives: List the primary goals the agent needs to achieve during the call.
3. Strict Constraints: Important for voice! (e.g., "Keep responses under 2 sentences", "Never use markdown like bold or lists", "Do not say 'How can I help you today' every time").
4. Interaction Rules: How to handle interruptions, quiet moments, and off-topic questions.

Write ONLY the system prompt text. Do not include any preamble, introduction, or formatting like "Here is your prompt:".`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API Error:", errText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!generatedText) {
      throw new Error("Gemini failed to generate a prompt.");
    }

    return new Response(
      JSON.stringify({ prompt: generatedText }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("generate-prompt error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
