// Test edge function: connects to Gemini Live API and reports result
// Used to verify Gemini WebSocket works from edge functions

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const model = "gemini-2.0-flash-live-001";
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

  console.log("Attempting Gemini WebSocket connection...");

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject("Timeout after 10s"), 10000);

      const ws = new WebSocket(geminiUrl);

      ws.onopen = () => {
        console.log("Gemini WS opened, sending setup...");
        ws.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Puck" },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: "You are a test assistant." }],
            },
          },
        }));
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        console.log("Gemini response keys:", Object.keys(msg));
        if (msg.setupComplete) {
          clearTimeout(timeout);
          ws.close();
          resolve("SUCCESS: Gemini setup complete");
        } else if (msg.error) {
          clearTimeout(timeout);
          ws.close();
          reject("Gemini error: " + JSON.stringify(msg.error));
        }
      };

      ws.onerror = (e) => {
        clearTimeout(timeout);
        console.error("Gemini WS error:", e);
        reject("WebSocket error");
      };

      ws.onclose = (ev) => {
        clearTimeout(timeout);
        console.log("Gemini WS closed:", ev.code, ev.reason);
        reject("WebSocket closed: code=" + ev.code + " reason=" + ev.reason);
      };
    });

    return new Response(JSON.stringify({ status: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Test failed:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
