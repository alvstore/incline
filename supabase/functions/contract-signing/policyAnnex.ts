// v1.0.0 — Annexure B (Policy Library) rendering + acknowledgement rows.

export interface SnapshotPolicy {
  policy_id: string; code: string; title: string; version: number;
  effective_from: string | null; body_markdown: string; body_hash: string;
}

export function parseSnapshot(raw: unknown): SnapshotPolicy[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p) => p && typeof p === "object" && (p as SnapshotPolicy).policy_id && (p as SnapshotPolicy).title) as SnapshotPolicy[];
}

/** Markdown block appended to the agreement; empty when no policies apply. */
export function annexureMarkdown(policies: SnapshotPolicy[]): string {
  if (!policies.length) return "";
  const index = policies.map((p, i) =>
    `* B${i + 1}. ${p.title} — v${p.version}${p.effective_from ? `, effective ${p.effective_from}` : ""}`).join("\n");
  const bodies = policies.map((p, i) =>
    `### B${i + 1}. ${p.title} (v${p.version})\n\n${String(p.body_markdown ?? "").replace(/^#{1,2}\s/gm, "### ").trim()}`).join("\n\n");
  return `\n\n---\n\n## ANNEXURE B — COMPANY POLICIES (FORM PART OF THIS AGREEMENT)\n\nBy signing, the Employee acknowledges receiving, reading and agreeing to follow the policies below at the versions listed. Later versions are shared separately for acknowledgement.\n\n${index}\n\n${bodies}`;
}

export function acknowledgementRows(policies: SnapshotPolicy[], ctx: {
  userId: string; employeeId: string | null; trainerId: string | null; branchId: string | null;
  signedName: string; signatureImagePath: string | null; ip: string | null; userAgent: string | null; geolocation: unknown;
}) {
  return policies.map((p) => ({
    policy_id: p.policy_id, policy_code: p.code, policy_version: p.version,
    user_id: ctx.userId, employee_id: ctx.employeeId, trainer_id: ctx.trainerId, branch_id: ctx.branchId,
    signed_name: ctx.signedName, signature_image_path: ctx.signatureImagePath, body_hash: p.body_hash,
    ip_address: ctx.ip, user_agent: ctx.userAgent, geolocation: ctx.geolocation ?? null,
  }));
}
