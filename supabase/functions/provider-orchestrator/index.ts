import {
  bootstrapProviderRuntime,
  createRuntimeDependencies,
  dispatchProviderTool,
  handleProviderTurn,
  type ProviderOrchestrationRequest,
} from "../_shared/provider-orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body?.action || "respond";
    const payload = (body?.payload || body) as ProviderOrchestrationRequest & {
      tool_name?: string;
      args?: Record<string, unknown>;
    };

    if (!payload?.agent_id) {
      return jsonResponse({ error: "agent_id is required" }, 400);
    }

    const deps = await createRuntimeDependencies();

    if (action === "dispatch_tool") {
      if (!payload.tool_name) {
        return jsonResponse({ error: "tool_name is required for dispatch_tool" }, 400);
      }

      const result = await dispatchProviderTool(
        deps,
        payload,
        payload.tool_name,
        payload.args || {},
      );

      return jsonResponse({ success: result.ok, result: result.data });
    }

    if (action === "bootstrap") {
      const result = await bootstrapProviderRuntime(deps, payload);

      return jsonResponse({
        success: true,
        provider: result.provider,
        state: result.state,
        system_prompt: result.system_prompt,
        tools: result.tools,
      });
    }

    const result = await handleProviderTurn(deps, payload);
    return jsonResponse({
      success: true,
      provider: result.provider,
      response: result.response,
      state: result.state,
      tools: result.tools,
    });
  } catch (error) {
    console.error("[provider-orchestrator] Error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
