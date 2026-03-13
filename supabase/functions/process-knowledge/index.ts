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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return new Response(
      JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { knowledge_item_id } = await req.json();
    if (!knowledge_item_id) {
      return new Response(
        JSON.stringify({ error: "knowledge_item_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the knowledge base item
    const { data: item, error: fetchError } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("id", knowledge_item_id)
      .single();

    if (fetchError || !item) {
      return new Response(
        JSON.stringify({ error: "Knowledge item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Set status to processing
    await supabase
      .from("knowledge_base_items")
      .update({ processing_status: "processing" })
      .eq("id", knowledge_item_id);

    let rawText = "";

    if (item.type === "website" && item.website_url) {
      // Fetch webpage HTML
      try {
        const res = await fetch(item.website_url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        // Strip HTML tags and clean up
        rawText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
      } catch (e) {
        console.error("Failed to fetch URL:", e);
        await supabase
          .from("knowledge_base_items")
          .update({ processing_status: "failed" })
          .eq("id", knowledge_item_id);
        return new Response(
          JSON.stringify({ error: `Failed to fetch URL: ${e.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (item.type === "document" && item.file_path) {
      // Download file from storage
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("knowledge-documents")
          .download(item.file_path);

        if (downloadError || !fileData) {
          throw new Error(downloadError?.message || "File not found");
        }

        const fileName = item.file_path.toLowerCase();
        if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
          rawText = await fileData.text();
        } else if (fileName.endsWith(".pdf")) {
          // For PDF, extract text as best effort
          rawText = await fileData.text();
        } else if (fileName.endsWith(".doc") || fileName.endsWith(".docx")) {
          // For DOC/DOCX, extract text as best effort
          rawText = await fileData.text();
        } else {
          rawText = await fileData.text();
        }
      } catch (e) {
        console.error("Failed to download file:", e);
        await supabase
          .from("knowledge_base_items")
          .update({ processing_status: "failed" })
          .eq("id", knowledge_item_id);
        return new Response(
          JSON.stringify({ error: `Failed to download file: ${e.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Text type - already has content, mark as completed
      await supabase
        .from("knowledge_base_items")
        .update({ processing_status: "completed" })
        .eq("id", knowledge_item_id);
      return new Response(
        JSON.stringify({ success: true, message: "Text content already stored" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate raw text to avoid exceeding token limits
    const truncatedText = rawText.slice(0, 50000);

    if (!truncatedText.trim()) {
      await supabase
        .from("knowledge_base_items")
        .update({ processing_status: "failed" })
        .eq("id", knowledge_item_id);
      return new Response(
        JSON.stringify({ error: "No text content could be extracted" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send to Gemini AI via Lovable AI Gateway for extraction
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You are a knowledge extraction assistant. Your job is to extract and structure ALL key information from the provided content into clean, organized text that an AI phone agent can reference during calls. Include all important facts, details, policies, FAQs, pricing, contact info, services, procedures, and any other relevant information. Organize with clear headings and bullet points. Be thorough - do not omit any useful information. Output plain text only, no markdown formatting.",
          },
          {
            role: "user",
            content: `Extract and structure all key information from the following content:\n\n${truncatedText}`,
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);

      if (aiResponse.status === 429) {
        await supabase
          .from("knowledge_base_items")
          .update({ processing_status: "failed" })
          .eq("id", knowledge_item_id);
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        await supabase
          .from("knowledge_base_items")
          .update({ processing_status: "failed" })
          .eq("id", knowledge_item_id);
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from("knowledge_base_items")
        .update({ processing_status: "failed" })
        .eq("id", knowledge_item_id);
      return new Response(
        JSON.stringify({ error: "AI processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const extractedContent = aiData.choices?.[0]?.message?.content || "";

    // Truncate to ~15K chars for system prompt manageability
    const finalContent = extractedContent.slice(0, 15000);

    // Update the knowledge base item
    await supabase
      .from("knowledge_base_items")
      .update({
        content: finalContent,
        processing_status: "completed",
      })
      .eq("id", knowledge_item_id);

    return new Response(
      JSON.stringify({ success: true, content_length: finalContent.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("process-knowledge error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
