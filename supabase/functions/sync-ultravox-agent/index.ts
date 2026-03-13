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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ultravoxApiKey = Deno.env.get("ULTRAVOX_API_KEY");

    if (!ultravoxApiKey) {
      return new Response(
        JSON.stringify({ error: "ULTRAVOX_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub;

    const { agent_id } = await req.json();
    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: "agent_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch agent (with retry for race condition on new creation)
    let agent: any = null;
    let agentError: any = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await supabase
        .from("agents")
        .select("*")
        .eq("id", agent_id)
        .eq("user_id", userId)
        .single();
      agent = result.data;
      agentError = result.error;

      if (agent) break;
      if (attempt === 0) {
        console.log("Agent not found on first attempt, retrying in 1s...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (agentError || !agent) {
      console.error(`Agent not found after retries: ${agent_id}, user: ${userId}`);
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only sync for ultravox provider
    if (agent.ai_provider !== "ultravox") {
      return new Response(
        JSON.stringify({ error: "Agent is not using Ultravox provider", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch knowledge base items for system prompt
    const { data: kbItems } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("agent_id", agent.id);

    let systemPrompt = agent.system_prompt;
    if (kbItems && kbItems.length > 0) {
      systemPrompt += "\n\n--- KNOWLEDGE BASE ---\n";
      for (const item of kbItems) {
        if (item.content) {
          systemPrompt += `\n## ${item.title}\n${item.content}\n`;
        } else if (item.website_url) {
          systemPrompt += `\n## ${item.title}\nRefer to: ${item.website_url}\n`;
        }
      }
    }

    // Fetch agent tools (custom HTTP tools)
    const { data: agentTools } = await supabase
      .from("agent_tools")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("is_active", true);

    // Build Ultravox selectedTools array
    const selectedTools: any[] = [];

    // Custom HTTP tools
    if (agentTools && agentTools.length > 0) {
      for (const tool of agentTools) {
        const dynamicParameters: any[] = [];
        if (Array.isArray(tool.parameters)) {
          for (const p of tool.parameters as any[]) {
            dynamicParameters.push({
              name: p.name,
              location: "PARAMETER_LOCATION_BODY",
              schema: { type: p.type || "string", description: p.description || "" },
              required: !!p.required,
            });
          }
        }

        // Build static parameters from headers and body template
        const staticParameters: any[] = [];
        if (tool.http_headers && typeof tool.http_headers === "object") {
          const headers = tool.http_headers as Record<string, string>;
          for (const [headerName, headerValue] of Object.entries(headers)) {
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
          const bodyTemplate = tool.http_body_template as Record<string, any>;
          for (const [key, value] of Object.entries(bodyTemplate)) {
            if (key) {
              staticParameters.push({
                name: key,
                location: "PARAMETER_LOCATION_BODY",
                value: String(value),
              });
            }
          }
        }

        const toolDef: any = {
          temporaryTool: {
            modelToolName: tool.name,
            description: tool.description,
            dynamicParameters,
            http: {
              baseUrlPattern: tool.http_url,
              httpMethod: tool.http_method,
            },
          },
        };

        if (staticParameters.length > 0) {
          toolDef.temporaryTool.staticParameters = staticParameters;
        }

        selectedTools.push(toolDef);
      }
    }

    // Fetch appointment tools
    const { data: appointmentTools } = await supabase
      .from("appointment_tools")
      .select("*, calendar_integrations(*)")
      .eq("agent_id", agent.id)
      .eq("is_active", true);

    if (appointmentTools && appointmentTools.length > 0) {
      // ... keep existing code
      const checkAvailabilityUrl = `${supabaseUrl}/functions/v1/check-calendar-availability`;
      const bookAppointmentUrl = `${supabaseUrl}/functions/v1/book-calendar-appointment`;

      for (const apptTool of appointmentTools) {
        const integration = (apptTool as any).calendar_integrations;
        if (!integration) continue;

        const enabledDays = Object.entries(apptTool.business_hours as Record<string, any>)
          .filter(([_, v]: any) => v.enabled)
          .map(([day, v]: any) => `${day}: ${v.start}-${v.end}`)
          .join(", ");
        const typesList = (apptTool.appointment_types as any[]).map((t: any) => `${t.name} (${t.duration}min)`).join(", ");

        systemPrompt += `\n\n--- APPOINTMENT TOOL: ${apptTool.name} ---`;
        systemPrompt += `\nProvider: ${apptTool.provider}`;
        systemPrompt += `\nBusiness Hours: ${enabledDays}`;
        systemPrompt += `\nAppointment Types: ${typesList}\n`;

        const toolNameSuffix = apptTool.name.replace(/[^a-zA-Z0-9]/g, '_');

        selectedTools.push({
          temporaryTool: {
            modelToolName: `check_availability_${toolNameSuffix}`,
            description: `Check calendar availability for ${apptTool.name}.`,
            dynamicParameters: [
              { name: "date", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Date (YYYY-MM-DD)" }, required: true },
            ],
            http: { baseUrlPattern: checkAvailabilityUrl, httpMethod: "POST" },
            staticParameters: [
              { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
              { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
            ],
          },
        });

        selectedTools.push({
          temporaryTool: {
            modelToolName: `book_appointment_${toolNameSuffix}`,
            description: `Book an appointment using ${apptTool.name}.`,
            dynamicParameters: [
              { name: "date_time", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "ISO 8601 date-time" }, required: true },
              { name: "name", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Person name" }, required: true },
              { name: "email", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: "Email" }, required: false },
              { name: "duration_minutes", location: "PARAMETER_LOCATION_BODY", schema: { type: "number", description: "Duration in min" }, required: false },
            ],
            http: { baseUrlPattern: bookAppointmentUrl, httpMethod: "POST" },
            staticParameters: [
              { name: "provider", location: "PARAMETER_LOCATION_BODY", value: apptTool.provider },
              { name: "integration_id", location: "PARAMETER_LOCATION_BODY", value: integration.id },
            ],
          },
        });
      }
    }

    // Fetch call forwarding numbers and inject transfer tool
    const { data: forwardingNumbers } = await supabase
      .from("call_forwarding_numbers")
      .select("*")
      .eq("agent_id", agent.id);

    if (forwardingNumbers && forwardingNumbers.length > 0) {
      const transferUrl = `${supabaseUrl}/functions/v1/transfer-call`;
      const numbersList = forwardingNumbers.map((fn: any) => `${fn.phone_number}${fn.label ? ` (${fn.label})` : ""}`).join(", ");

      systemPrompt += `\n\n--- CALL FORWARDING ---`;
      systemPrompt += `\nYou can transfer the caller to a human agent if they request it or if you cannot help them.`;
      systemPrompt += `\nAvailable transfer destinations: ${numbersList}`;
      systemPrompt += `\nUse the transferCall tool to transfer the call. Always confirm with the caller before transferring.\n`;

      selectedTools.push({
        temporaryTool: {
          modelToolName: "transferCall",
          description: `Transfer the current call to a human agent. Available destinations: ${numbersList}. Always confirm with the caller before transferring.`,
          dynamicParameters: [
            { name: "destination_number", location: "PARAMETER_LOCATION_BODY", schema: { type: "string", description: `Phone number to transfer to. Must be one of: ${forwardingNumbers.map((fn: any) => fn.phone_number).join(", ")}` }, required: true },
          ],
          http: { baseUrlPattern: transferUrl, httpMethod: "POST" },
        },
      });
    }

    // Fetch webhooks for this agent
    const { data: webhooks } = await supabase
      .from("webhooks")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("is_active", true);

    // Build model name
    let modelName = agent.model || "fixie-ai/ultravox-v0.7";
    if (modelName && !modelName.includes("/")) {
      modelName = `fixie-ai/${modelName}`;
    }

    // Sanitize name for Ultravox: only alphanumeric, underscore, hyphen, max 64 chars
    // Append short agent ID suffix to ensure uniqueness across agents with the same display name
    const idSuffix = agent.id.replace(/-/g, '').substring(0, 8);
    const sanitizedName = (agent.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + idSuffix).substring(0, 64);

    // Build the correct Ultravox Agent API body with callTemplate nesting
    const callTemplate: any = {
      systemPrompt,
      model: modelName,
      voice: agent.voice,
      temperature: Number(agent.temperature),
      languageHint: agent.language_hint || "en",
      maxDuration: agent.max_duration ? `${agent.max_duration}s` : "300s",
      firstSpeakerSettings: agent.first_speaker === "FIRST_SPEAKER_USER" ? { user: {} } : { agent: {} },
    };

    if (selectedTools.length > 0) {
      callTemplate.selectedTools = selectedTools;
    }

    const ultravoxAgentBody: any = {
      name: sanitizedName,
      callTemplate,
    };

    console.log(`Ultravox request body: ${JSON.stringify(ultravoxAgentBody).substring(0, 500)}`);

    let ultravoxAgentId = agent.ultravox_agent_id;
    let response: Response;

    if (ultravoxAgentId) {
      // Update existing Ultravox agent
      console.log(`Updating Ultravox agent: ${ultravoxAgentId}`);
      response = await fetch(`https://api.ultravox.ai/api/agents/${ultravoxAgentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ultravoxApiKey,
        },
        body: JSON.stringify(ultravoxAgentBody),
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log("Ultravox agent not found, creating new one");
          ultravoxAgentId = null;
        } else {
          const errorText = await response.text();
          console.error(`Ultravox update error (${response.status}): ${errorText}`);
          return new Response(
            JSON.stringify({ error: "Failed to update Ultravox agent", details: errorText }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    if (!ultravoxAgentId) {
      // Create new Ultravox agent
      console.log("Creating new Ultravox agent");
      response = await fetch("https://api.ultravox.ai/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ultravoxApiKey,
        },
        body: JSON.stringify(ultravoxAgentBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ultravox create error (${response.status}): ${errorText}`);
        return new Response(
          JSON.stringify({ error: "Failed to create Ultravox agent", details: errorText }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const ultravoxData = await response!.json();
    console.log(`Ultravox response: ${JSON.stringify(ultravoxData).substring(0, 500)}`);
    const newUltravoxAgentId = ultravoxData.agentId || ultravoxData.agent_id || ultravoxData.id;

    console.log(`Ultravox agent synced: ${newUltravoxAgentId}`);

    // Save the Ultravox agent ID back to our DB
    if (newUltravoxAgentId && newUltravoxAgentId !== agent.ultravox_agent_id) {
      await supabase
        .from("agents")
        .update({ ultravox_agent_id: newUltravoxAgentId })
        .eq("id", agent.id);
    }

    // Sync webhooks to Ultravox if any
    if (webhooks && webhooks.length > 0 && newUltravoxAgentId) {
      for (const wh of webhooks) {
        try {
          const whBody: any = {
            url: wh.url,
            events: wh.events || ["call.completed"],
            agentId: newUltravoxAgentId,
          };
          if (wh.secret) {
            whBody.secret = wh.secret;
          }
          const whResp = await fetch("https://api.ultravox.ai/api/webhooks", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": ultravoxApiKey,
            },
            body: JSON.stringify(whBody),
          });
          if (!whResp.ok) {
            const whErr = await whResp.text();
            console.error(`Webhook sync error for ${wh.name}: ${whErr}`);
          } else {
            console.log(`Webhook synced: ${wh.name}`);
          }
        } catch (whError: any) {
          console.error(`Webhook sync exception for ${wh.name}: ${whError.message}`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ultravox_agent_id: newUltravoxAgentId,
        action: agent.ultravox_agent_id ? "updated" : "created",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("sync-ultravox-agent error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
