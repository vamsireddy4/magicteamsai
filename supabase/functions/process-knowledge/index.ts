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
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!geminiApiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
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
        let url = item.website_url.trim();
        if (!/^https?:\/\//i.test(url)) {
          url = "https://" + url;
        }
        const res = await fetch(url, {
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
        const isPdf = fileName.endsWith(".pdf");
        const isDoc = fileName.endsWith(".doc") || fileName.endsWith(".docx");

        if (isPdf || isDoc) {
          // For binary documents (PDF/DOC), convert to base64 and send directly to Gemini
          const arrayBuffer = await fileData.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Data = btoa(binary);
          const mimeType = isPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

          // Use Gemini directly with the file as inline data
          const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  { text: "You are a knowledge extraction assistant. Extract and structure all key information from this document into clean organized text for an AI phone agent. Include all important facts, policies, pricing, contact info, services, procedures, and FAQs. Output plain text only." },
                  {
                    inlineData: {
                      mimeType,
                      data: base64Data,
                    },
                  },
                ],
              }],
            }),
          });

          if (!aiResponse.ok) {
            const errText = await aiResponse.text();
            console.error("AI gateway error for document:", aiResponse.status, errText);
            await supabase
              .from("knowledge_base_items")
              .update({ processing_status: "failed" })
              .eq("id", knowledge_item_id);
            return new Response(
              JSON.stringify({ error: `AI processing failed: ${aiResponse.status}` }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const aiData = await aiResponse.json();
          const extractedContent = aiData?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";
          const finalContent = extractedContent.slice(0, 15000);

          await supabase
            .from("knowledge_base_items")
            .update({ content: finalContent, processing_status: "completed" })
            .eq("id", knowledge_item_id);

          return new Response(
            JSON.stringify({ success: true, content_length: finalContent.length }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          // Plain text files (txt, md, csv, etc.)
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

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `You are a knowledge extraction assistant. Extract and structure ALL key information from the following content into clean organized text for an AI phone agent. Include facts, policies, pricing, contact info, services, procedures, and FAQs. Output plain text only.\n\n${truncatedText}`,
          }],
        }],
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
    const extractedContent = aiData?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";

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
