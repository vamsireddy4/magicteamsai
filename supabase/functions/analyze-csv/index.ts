const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { csvContent } = await req.json();

    if (!csvContent) {
      return new Response(
        JSON.stringify({ error: "CSV content is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send first ~200 rows max to AI for analysis
    const lines = csvContent.trim().split("\n");
    const preview = lines.slice(0, Math.min(lines.length, 201)).join("\n");
    const totalRows = lines.length - 1; // minus header

    const prompt = `You are a CSV data analyst. Analyze this CSV data and return a JSON response.

The CSV has ${totalRows} total data rows. Here is the data (header + up to 200 rows):

\`\`\`
${preview}
\`\`\`

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
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
- "columns" should list ALL columns found in the CSV, with clean human-readable labels
- Detect column types: phone numbers → "phone", dates → "date", numbers → "number", emails → "email", everything else → "text"
- "rows" should contain ALL rows from the CSV (up to 200), with values cleaned (trim whitespace, normalize phone numbers to include country code if missing)
- Remove completely empty rows
- Deduplicate rows that have the same phone number, merging any differing child/name fields with commas
- In "summary", describe what the data is about`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", errText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed", details: errText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await response.json();
    const content = aiData?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";

    // Parse JSON from AI response (handle potential markdown wrapping)
    let parsed;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI analysis", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ...parsed, totalRows }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
