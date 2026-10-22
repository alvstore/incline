// scan-ai-analysis v1.0.0 — structured, value-by-value AI reading of a scan.
// Cached in scan_report_ai_analysis by input hash; never blocks delivery.
import { callAI } from "./ai-dispatcher.ts";
import type { AiAnalysis } from "./scan-report-pdf-v2.ts";

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (x: unknown, max = 600) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const arr = (x: unknown, max = 8) => (Array.isArray(x) ? x.map((s) => str(s, 300)).filter(Boolean).slice(0, max) : []);

export function parseAnalysis(raw: string): AiAnalysis | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    const a: AiAnalysis = {
      summary: str(j.summary, 900),
      items: (Array.isArray(j.items) ? j.items : []).slice(0, 16).map((i: any) => ({
        term: str(i.term, 60), value: str(i.value, 40), status: str(i.status, 24) || "Note",
        explanation: str(i.explanation, 500), why: str(i.why, 300) || undefined,
      })).filter((i: any) => i.term && i.explanation),
      strengths: arr(j.strengths, 6),
      focus: arr(j.focus, 6),
      plan: (Array.isArray(j.plan) ? j.plan : []).slice(0, 4).map((w: any) => ({ week: str(w.week, 40), actions: arr(w.actions, 5) })).filter((w: any) => w.week && w.actions.length),
      questions: arr(j.questions, 5),
    };
    return a.summary && a.items.length ? a : null;
  } catch { return null; }
}

export async function getOrCreateAnalysis(
  supabase: any,
  opts: { reportId: string; kind: "body" | "posture"; memberId: string; branchId: string | null; firstName: string; facts: string; force?: boolean },
): Promise<AiAnalysis | null> {
  const hash = await sha(`${opts.kind}|v1|${opts.facts}`);
  if (!opts.force) {
    const { data } = await supabase.from("scan_report_ai_analysis").select("analysis, input_hash")
      .eq("report_id", opts.reportId).eq("kind", opts.kind).maybeSingle();
    if (data?.input_hash === hash && data.analysis) return data.analysis as AiAnalysis;
  }
  try {
    const sys =
      "You are a senior fitness and posture coach at Incline, a premium gym in Udaipur. You read a member's in-club 3D " +
      (opts.kind === "body" ? "body composition (BIA) scan" : "posture scan") +
      " and explain EVERY value clearly. Return ONLY valid JSON, no markdown, matching: " +
      '{"summary":"3-4 sentences","items":[{"term":"name of the measure","value":"number with unit","status":"In range|Watch|Above range|Below range","explanation":"max 40 words: what this term means in plain words and what THIS number says","why":"max 18 words: why it matters"}],' +
      '"strengths":["..."],"focus":["..."],"plan":[{"week":"Week 1","actions":["specific gym action"]},{"week":"Week 2","actions":[]},{"week":"Weeks 3-4","actions":[]}],"questions":["question to ask the trainer"]}. ' +
      "Keep it compact: summary max 70 words, max 14 items, max 4 strengths/focus, max 4 actions per week (each max 25 words), max 4 questions. Total output under 1400 words. Rules: include one item for every value given (and segment balance if provided). Use only the numbers provided; do not invent values. " +
      (opts.kind === "posture"
        ? "Plan must include specific corrective and mobility drills (e.g. chin tucks, wall angels, glute bridges, dead bugs) with sets/reps. "
        : "Plan must cover strength training, cardio, protein/hydration habits and sleep, with concrete numbers where sensible. ") +
      "Never diagnose, never name diseases, medication or medical conditions, never quote prices. Warm, direct, second person. English only.";
    let a: AiAnalysis | null = null;
    for (let attempt = 0; attempt < 2 && !a; attempt++) {
      const { content } = await callAI({
        scope: "all", supabase, temperature: 0.3, max_tokens: 10000, timeoutMs: 55000,
        messages: [
          { role: "system", content: sys + (attempt ? " Your previous answer was too long and got cut off. Be MUCH shorter: half the words." : "") },
          { role: "user", content: `Member first name: ${opts.firstName}.\n${opts.facts}` },
        ],
      });
      a = parseAnalysis(String(content || ""));
      if (!a) console.warn("scan AI analysis unparsable, attempt", attempt + 1, "length", String(content || "").length);
    }
    if (!a) {
      // Keep the last good analysis rather than sending a report without one.
      const { data } = await supabase.from("scan_report_ai_analysis").select("analysis")
        .eq("report_id", opts.reportId).eq("kind", opts.kind).maybeSingle();
      return (data?.analysis as AiAnalysis) ?? null;
    }
    await supabase.from("scan_report_ai_analysis").upsert({
      report_id: opts.reportId, kind: opts.kind, member_id: opts.memberId, branch_id: opts.branchId,
      input_hash: hash, analysis: a, updated_at: new Date().toISOString(),
    }, { onConflict: "report_id,kind" });
    return a;
  } catch (e) {
    console.warn("scan AI analysis failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
