// Shared AI dispatcher — routes chat-completion calls to the active provider
// for the given scope (Lovable AI, OpenRouter, Ollama, DeepSeek, or any
// OpenAI-compatible endpoint), with optional automatic fallback to Lovable AI.
//
// Usage from any edge function:
//   import { callAI } from "../_shared/ai-dispatcher.ts";
//   const { content, provider } = await callAI({
//     scope: "whatsapp_ai",
//     messages: [{ role: "user", content: "hi" }],
//     supabase,
//   });

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_LOVABLE_MODEL = "google/gemini-3-flash-preview";

export type AIScope = "all" | "whatsapp_ai" | "lead_scoring" | "fitness_plans" | "dashboard_insights" | "lead_nurture";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
  tool_calls?: any;
  tool_call_id?: string;
  name?: string;
}

export interface CallAIOptions {
  scope: AIScope;
  messages: ChatMessage[];
  supabase?: SupabaseClient;
  model?: string;            // override the provider's default
  tools?: any[];
  tool_choice?: any;
  response_format?: any;
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high" | "xhigh" };
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;        // default 60000
}

export interface CallAIResult {
  content: string;
  raw: any;
  provider: string;
  model: string;
  fallback_used: boolean;
}

interface ProviderConfig {
  provider: "lovable" | "openrouter" | "ollama" | "deepseek" | "google" | "groq" | "together" | "mistral" | "openai_compatible";
  display_name: string;
  base_url: string | null;
  api_key_secret_name: string | null;
  default_model: string;
  enable_fallback: boolean;
  extra_config: Record<string, any>;
}

function getServiceSupabase(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

async function resolveProvider(
  supabase: SupabaseClient,
  scope: AIScope,
): Promise<ProviderConfig> {
  // 1. Active default for this exact scope
  let { data } = await supabase
    .from("ai_provider_configs")
    .select("provider, display_name, base_url, api_key_secret_name, default_model, enable_fallback, extra_config")
    .eq("scope", scope)
    .eq("is_active", true)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) return data as ProviderConfig;

  // 2. Active default for "all" scope
  ({ data } = await supabase
    .from("ai_provider_configs")
    .select("provider, display_name, base_url, api_key_secret_name, default_model, enable_fallback, extra_config")
    .eq("scope", "all")
    .eq("is_active", true)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());

  if (data) return data as ProviderConfig;

  // 3. Hard-coded fallback to Lovable AI
  return {
    provider: "lovable",
    display_name: "Lovable AI (built-in)",
    base_url: LOVABLE_GATEWAY,
    api_key_secret_name: "LOVABLE_API_KEY",
    default_model: DEFAULT_LOVABLE_MODEL,
    enable_fallback: false,
    extra_config: {},
  };
}

// Mirror of src/lib/ai/providerCatalog.ts normalizeModelForProvider.
// Prevents Lovable-namespaced model IDs (e.g. "google/gemini-3-flash-preview")
// from being sent to providers that don't recognize them (Google direct API
// returns 404, then we fall back to Lovable — exactly what we want to avoid).
function normalizeModelForProvider(provider: string, model: string): string {
  if (!model) return model;
  if (provider === "google") {
    let m = model.replace(/^google\//, "");
    const map: Record<string, string> = {
      "gemini-3-flash-preview": "gemini-flash-latest",
      "gemini-3.1-flash-lite-preview": "gemini-flash-lite-latest",
      "gemini-3.1-pro-preview": "gemini-pro-latest",
      "gemini-2.0-flash": "gemini-flash-latest",
    };
    return map[m] ?? m;
  }
  if (provider === "lovable" && !model.includes("/")) {
    return `google/${model}`;
  }
  return model;
}

function buildEndpoint(cfg: ProviderConfig): string {
  if (cfg.base_url && cfg.base_url.length > 0) return cfg.base_url;
  switch (cfg.provider) {
    case "lovable":
      return LOVABLE_GATEWAY;
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "deepseek":
      return "https://api.deepseek.com/v1/chat/completions";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "together":
      return "https://api.together.xyz/v1/chat/completions";
    case "mistral":
      return "https://api.mistral.ai/v1/chat/completions";
    case "ollama":
      throw new Error("Ollama provider requires base_url to be set (e.g. https://ollama.example.com/v1/chat/completions)");
    case "openai_compatible":
      throw new Error("openai_compatible provider requires base_url to be set");
  }
}

async function executeCall(
  cfg: ProviderConfig,
  opts: CallAIOptions,
): Promise<{ content: string; raw: any; model: string }> {
  const endpoint = buildEndpoint(cfg);
  const apiKey = cfg.api_key_secret_name ? Deno.env.get(cfg.api_key_secret_name) : null;
  const rawModel = opts.model || cfg.default_model;
  const model = normalizeModelForProvider(cfg.provider, rawModel);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = cfg.extra_config?.referer || "https://incline.lovable.app";
    headers["X-Title"] = cfg.extra_config?.title || "Incline CRM";
  }

  const body: Record<string, any> = {
    model,
    messages: opts.messages,
    stream: false,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.reasoning) body.reasoning = opts.reasoning;
  // OpenAI's newer models reject `max_tokens` and ignore non-default temperature.
  // Always use `max_completion_tokens` for OpenAI; gate temperature behind a
  // best-effort check on legacy chat models only.
  const isOpenAI = cfg.provider === "openai";
  const isLegacyOpenAIChat = isOpenAI && /^(gpt-3|gpt-4(?!\.))/i.test(model);
  if (opts.temperature !== undefined && (!isOpenAI || isLegacyOpenAIChat)) {
    body.temperature = opts.temperature;
  }
  if (opts.max_tokens !== undefined) {
    if (isOpenAI) body.max_completion_tokens = opts.max_tokens;
    else body.max_tokens = opts.max_tokens;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60000);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${cfg.provider} HTTP ${resp.status}: ${text.slice(0, 400)}`);
    }

    const json = await resp.json();
    const content =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      "";

    return { content: typeof content === "string" ? content : JSON.stringify(content), raw: json, model };
  } finally {
    clearTimeout(timer);
  }
}

async function logCall(
  supabase: SupabaseClient,
  row: {
    provider: string;
    scope: string;
    model: string;
    status: "success" | "error" | "fallback";
    duration_ms: number;
    error_message?: string;
    fallback_used?: boolean;
  },
) {
  // Fire-and-forget; never block the caller
  supabase.from("ai_call_logs").insert(row).then(() => {}).catch(() => {});
}

export async function callAI(opts: CallAIOptions): Promise<CallAIResult> {
  const supabase = opts.supabase ?? getServiceSupabase();
  const primary = await resolveProvider(supabase, opts.scope);
  const start = Date.now();

  try {
    const result = await executeCall(primary, opts);
    logCall(supabase, {
      provider: primary.provider,
      scope: opts.scope,
      model: result.model,
      status: "success",
      duration_ms: Date.now() - start,
    });
    return {
      content: result.content,
      raw: result.raw,
      provider: primary.provider,
      model: result.model,
      fallback_used: false,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[ai-dispatcher] primary provider ${primary.provider} failed:`, errorMessage);

    if (primary.enable_fallback && primary.provider !== "lovable") {
      try {
        const fallback: ProviderConfig = {
          provider: "lovable",
          display_name: "Lovable AI (fallback)",
          base_url: LOVABLE_GATEWAY,
          api_key_secret_name: "LOVABLE_API_KEY",
          default_model: DEFAULT_LOVABLE_MODEL,
          enable_fallback: false,
          extra_config: {},
        };
        const result = await executeCall(fallback, opts);
        logCall(supabase, {
          provider: "lovable",
          scope: opts.scope,
          model: result.model,
          status: "fallback",
          duration_ms: Date.now() - start,
          error_message: `primary ${primary.provider} failed: ${errorMessage}`,
          fallback_used: true,
        });
        return {
          content: result.content,
          raw: result.raw,
          provider: "lovable",
          model: result.model,
          fallback_used: true,
        };
      } catch (fbErr) {
        const fbMessage = fbErr instanceof Error ? fbErr.message : String(fbErr);
        logCall(supabase, {
          provider: primary.provider,
          scope: opts.scope,
          model: opts.model || primary.default_model,
          status: "error",
          duration_ms: Date.now() - start,
          error_message: `primary failed: ${errorMessage}; fallback failed: ${fbMessage}`,
          fallback_used: true,
        });
        throw new Error(`Both primary (${primary.provider}) and fallback (lovable) failed. ${fbMessage}`);
      }
    }

    logCall(supabase, {
      provider: primary.provider,
      scope: opts.scope,
      model: opts.model || primary.default_model,
      status: "error",
      duration_ms: Date.now() - start,
      error_message: errorMessage,
    });
    throw err;
  }
}
