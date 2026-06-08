// v1.0.0 — Catalog → ai_knowledge sync. Upserts canonical, Founder's-Phase-safe
// reference cards (plans, PT packages, branches, facilities) into ai_knowledge
// so RAG retrieval has real ground truth. Stable source_ref makes this
// idempotent; the existing tg_ai_knowledge_enqueue_embed trigger handles
// embeddings.
//
// Rules enforced (Founder's Phase):
//   • Never write ₹/Rs./prices/fees.
//   • Never write PT session counts.
//   • Plan duration words (monthly/quarterly/half-yearly/annual) are allowed.
//
// Dispatched by automation-brain (rule: sync_ai_knowledge) or invoked manually.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface KbCard {
  source_ref: string;        // unique idempotency key
  branch_id: string | null;
  topic: string;
  title: string;
  content: string;
  tags: string[];
  applies_to: string[];
  priority: number;
}

function durationWord(days: number): string {
  if (days <= 35) return "monthly";
  if (days <= 100) return "quarterly";
  if (days <= 200) return "half-yearly";
  if (days >= 330) return "annual";
  return `${days}-day`;
}

async function syncPlans(): Promise<KbCard[]> {
  const { data: plans } = await supabase
    .from("membership_plans")
    .select("id, branch_id, name, description, duration_days, is_active")
    .eq("is_active", true);
  if (!plans) return [];
  return plans.map((p: any): KbCard => ({
    source_ref: `plan:${p.id}`,
    branch_id: p.branch_id ?? null,
    topic: "plans",
    title: `Plan — ${p.name}`,
    content: [
      `Plan name: ${p.name}.`,
      `Duration: ${durationWord(p.duration_days)} (${p.duration_days} days).`,
      p.description ? `Notes: ${p.description}` : "",
      `Pricing: shared privately after onboarding chat. Do not quote numbers.`,
    ].filter(Boolean).join(" "),
    tags: ["plan", "membership", durationWord(p.duration_days)],
    applies_to: ["whatsapp", "instagram", "messenger", "all"],
    priority: 200,
  }));
}

async function syncPtPackages(): Promise<KbCard[]> {
  const { data: pkgs } = await supabase
    .from("pt_packages")
    .select("id, branch_id, name, description, is_active")
    .eq("is_active", true);
  if (!pkgs) return [];
  return pkgs.map((p: any): KbCard => ({
    source_ref: `pt:${p.id}`,
    branch_id: p.branch_id ?? null,
    topic: "pt",
    title: `Personal Training — ${p.name}`,
    content: [
      `Personal Training offering: ${p.name}.`,
      p.description ? `Notes: ${p.description}` : "",
      `Do not quote session counts, package contents, or pricing publicly during Founder's Phase. Route detailed asks to a quick onboarding chat.`,
    ].filter(Boolean).join(" "),
    tags: ["pt", "personal_training"],
    applies_to: ["whatsapp", "instagram", "messenger", "all"],
    priority: 150,
  }));
}

async function syncBranches(): Promise<KbCard[]> {
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, address, city, state, phone, email, opening_time, closing_time, is_active")
    .eq("is_active", true);
  if (!branches) return [];
  return branches.map((b: any): KbCard => ({
    source_ref: `branch:${b.id}`,
    branch_id: b.id,
    topic: "branch",
    title: `Branch — ${b.name}`,
    content: [
      `Branch: ${b.name}.`,
      b.address ? `Address: ${b.address}${b.city ? `, ${b.city}` : ""}${b.state ? `, ${b.state}` : ""}.` : "",
      `Hours: ${b.opening_time ?? "06:00"} – ${b.closing_time ?? "22:00"} (24/7 access for active members where supported).`,
      b.phone ? `Front desk: ${b.phone}.` : "",
      b.email ? `Email: ${b.email}.` : "",
    ].filter(Boolean).join(" "),
    tags: ["branch", "hours", "location"],
    applies_to: ["whatsapp", "instagram", "messenger", "all"],
    priority: 250,
  }));
}

async function syncFacilities(): Promise<KbCard[]> {
  const { data: facs } = await supabase
    .from("facilities")
    .select("id, branch_id, name, description, gender_access, is_active, under_maintenance")
    .eq("is_active", true);
  if (!facs) return [];
  return facs
    .filter((f: any) => !f.under_maintenance)
    .map((f: any): KbCard => ({
      source_ref: `facility:${f.id}`,
      branch_id: f.branch_id,
      topic: "facility",
      title: `Facility — ${f.name}`,
      content: [
        `Facility: ${f.name}.`,
        `Access: ${f.gender_access ?? "unisex"}.`,
        f.description ? `Description: ${f.description}` : "",
        `Bookable via the member app; staff can confirm availability.`,
      ].filter(Boolean).join(" "),
      tags: ["facility", "recovery", f.name.toLowerCase().replace(/\s+/g, "_")],
      applies_to: ["whatsapp", "instagram", "messenger", "all"],
      priority: 180,
    }));
}

// Founder's Phase sanitizer — strip any ₹/price/PT-session leakage that snuck
// through from catalog descriptions.
function sanitize(text: string): string {
  return text
    .replace(/[₹$€£]\s?\d[\d,]*/g, "[price redacted]")
    .replace(/\brs\.?\s?\d[\d,]*/gi, "[price redacted]")
    .replace(/\b\d+\s*(?:sessions?|pt sessions?)\b/gi, "[sessions redacted]");
}

async function upsertAll(cards: KbCard[]) {
  let upserted = 0;
  for (const c of cards) {
    const safeContent = sanitize(c.content);
    // Partial unique index on source_ref (WHERE NOT NULL) means PostgREST
    // upsert onConflict can't target it. Use explicit delete-then-insert.
    await supabase.from("ai_knowledge").delete().eq("source_ref", c.source_ref);
    const { error } = await supabase.from("ai_knowledge").insert({
      source: "catalog",
      source_ref: c.source_ref,
      branch_id: c.branch_id,
      topic: c.topic,
      title: c.title,
      content: safeContent,
      tags: c.tags,
      applies_to: c.applies_to,
      priority: c.priority,
      is_active: true,
      status: "active",
    });
    if (error) {
      console.warn("[sync-ai-knowledge] insert failed", c.source_ref, error.message);
      continue;
    }
    upserted++;
  }
  return upserted;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const [plans, pts, branches, facs] = await Promise.all([
      syncPlans(),
      syncPtPackages(),
      syncBranches(),
      syncFacilities(),
    ]);
    const all = [...plans, ...pts, ...branches, ...facs];
    const upserted = await upsertAll(all);
    const summary = {
      ok: true,
      took_ms: Date.now() - started,
      counts: { plans: plans.length, pt: pts.length, branches: branches.length, facilities: facs.length },
      upserted,
    };
    console.log("[sync-ai-knowledge]", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[sync-ai-knowledge] fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
