// v1.0.0 — AI Runtime: Single Source of Truth for one-shot AI calls.
// Every edge function that needs an AI completion calls `generateOnce({ purpose, branchId, ... })`.
// Config (system prompt, model, temperature, max_tokens, response_format) is loaded
// from `ai_purposes` (branch row → global fallback). Provider/model routing reuses
// `_shared/ai-dispatcher.ts::callAI`.
//
// Every call writes one row to `ai_call_logs` tagged with purpose + branch.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAI, type AIScope, type ChatMessage } from "./ai-dispatcher.ts";

export type Purpose =
  | "whatsapp_reply"
  | "lead_nurture"
  | "lead_score"
  | "campaign_draft"
  | "template_generate"
  | "dashboard_insight"
  | "fitness_plan"
  | "review_reply"
  | "automation_rule";

interface PurposeRow {
  enabled: boolean;
  model: string | null;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  tools_allowed: string[];
  guards: Record<string, unknown>;
  extra: Record<string, unknown>;
}

const SCOPE_MAP: Record<Purpose, AIScope> = {
  whatsapp_reply: "whatsapp_ai",
  lead_nurture: "lead_nurture",
  lead_score: "lead_scoring",
  campaign_draft: "all",
  template_generate: "all",
  dashboard_insight: "dashboard_insights",
  fitness_plan: "fitness_plans",
  review_reply: "all",
  automation_rule: "all",
};

export interface GenerateOnceOptions {
  purpose: Purpose;
  branchId?: string | null;
  userMessage: string;
  systemOverride?: string;     // appended to purpose system_prompt
  model?: string;              // overrides purpose.model
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  tools?: any[];               // OpenAI-style tool definitions (function calling)
  toolChoice?: any;            // optional forced tool choice
  supabase?: SupabaseClient;
  context?: Record<string, unknown>; // logged for debugging
}

export interface GenerateOnceResult {
  content: string;
  json?: any;                   // parsed JSON when responseFormat='json' OR tool args
  toolCallArgs?: any;           // parsed first tool_call.function.arguments
  provider: string;
  model: string;
  fallback_used: boolean;
  purpose_enabled: boolean;
  duration_ms: number;
}

function getServiceSupabase(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function loadPurpose(
  supabase: SupabaseClient,
  purpose: Purpose,
  branchId?: string | null,
): Promise<PurposeRow | null> {
  // try branch-specific row first
  if (branchId) {
    const { data } = await supabase
      .from("ai_purposes")
      .select("enabled, model, system_prompt, temperature, max_tokens, tools_allowed, guards, extra")
      .eq("purpose", purpose)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (data) return data as PurposeRow;
  }
  const { data: globalRow } = await supabase
    .from("ai_purposes")
    .select("enabled, model, system_prompt, temperature, max_tokens, tools_allowed, guards, extra")
    .eq("purpose", purpose)
    .is("branch_id", null)
    .maybeSingle();
  return (globalRow as PurposeRow) ?? null;
}

async function logCall(
  supabase: SupabaseClient,
  row: {
    purpose: string;
    branch_id?: string | null;
    provider: string;
    model: string | null;
    status: "success" | "error" | "fallback";
    duration_ms: number;
    fallback_used?: boolean;
    error_message?: string | null;
  },
) {
  try {
    await supabase.from("ai_call_logs").insert({
      purpose: row.purpose,
      scope: SCOPE_MAP[row.purpose as Purpose] ?? "all",
      branch_id: row.branch_id ?? null,
      provider: row.provider,
      model: row.model,
      status: row.status,
      duration_ms: row.duration_ms,
      fallback_used: row.fallback_used ?? false,
      error_message: row.error_message ?? null,
    });
  } catch (e) {
    console.warn("[ai-runtime] log insert failed:", (e as Error).message);
  }
}

/** Single entry point for all one-shot AI calls. */
export async function generateOnce(opts: GenerateOnceOptions): Promise<GenerateOnceResult> {
  const sb = opts.supabase ?? getServiceSupabase();
  const started = Date.now();
  const purposeRow = await loadPurpose(sb, opts.purpose, opts.branchId ?? null);

  const enabled = purposeRow?.enabled !== false; // default ON if no row
  if (!enabled) {
    return {
      content: "",
      provider: "disabled",
      model: "",
      fallback_used: false,
      purpose_enabled: false,
      duration_ms: 0,
    };
  }

  const systemFromConfig = purposeRow?.system_prompt?.trim() || "";
  const systemFinal = [systemFromConfig, opts.systemOverride?.trim()]
    .filter(Boolean)
    .join("\n\n");

  const messages: ChatMessage[] = [];
  if (systemFinal) messages.push({ role: "system", content: systemFinal });
  messages.push({ role: "user", content: opts.userMessage });

  const responseFormat =
    opts.responseFormat ??
    (purposeRow?.extra?.response_format === "json" ? "json" : "text");

  const callOpts: Parameters<typeof callAI>[0] = {
    scope: SCOPE_MAP[opts.purpose],
    messages,
    supabase: sb,
    model: opts.model ?? purposeRow?.model ?? undefined,
    temperature: opts.temperature ?? purposeRow?.temperature ?? undefined,
    max_tokens: opts.maxTokens ?? purposeRow?.max_tokens ?? undefined,
  };
  if (responseFormat === "json") {
    callOpts.response_format = { type: "json_object" };
  }

  try {
    const r = await callAI(callOpts);
    const dur = Date.now() - started;
    let parsedJson: any = undefined;
    if (responseFormat === "json") {
      try {
        const cleaned = r.content
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .trim();
        parsedJson = JSON.parse(cleaned);
      } catch {
        // leave parsedJson undefined; caller can inspect content
      }
    }
    await logCall(sb, {
      purpose: opts.purpose,
      branch_id: opts.branchId ?? null,
      provider: r.provider,
      model: r.model,
      status: r.fallback_used ? "fallback" : "success",
      duration_ms: dur,
      fallback_used: r.fallback_used,
    });
    return {
      content: r.content,
      json: parsedJson,
      provider: r.provider,
      model: r.model,
      fallback_used: r.fallback_used,
      purpose_enabled: true,
      duration_ms: dur,
    };
  } catch (err) {
    const dur = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    await logCall(sb, {
      purpose: opts.purpose,
      branch_id: opts.branchId ?? null,
      provider: "unknown",
      model: opts.model ?? purposeRow?.model ?? null,
      status: "error",
      duration_ms: dur,
      error_message: msg,
    });
    throw err;
  }
}
