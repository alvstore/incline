// Pure helpers for PT package expiry / low-session reminders.
export type PtAudience = "member" | "trainer" | "manager";
export type PtChannel = "notification" | "email" | "sms" | "rcs" | "whatsapp";

export interface PtExpirySettings {
  low_sessions: number;
  audiences: Record<PtAudience, { enabled: boolean; channels: PtChannel[] }>;
}

export const DEFAULT_PT_SETTINGS: PtExpirySettings = {
  low_sessions: 2,
  audiences: {
    member: { enabled: true, channels: ["notification"] },
    trainer: { enabled: true, channels: ["notification"] },
    manager: { enabled: false, channels: ["notification"] },
  },
};

export function normalizePtSettings(raw: unknown): PtExpirySettings {
  const r = (raw ?? {}) as Partial<PtExpirySettings>;
  const out: PtExpirySettings = JSON.parse(JSON.stringify(DEFAULT_PT_SETTINGS));
  if (typeof r.low_sessions === "number" && r.low_sessions >= 0) out.low_sessions = Math.floor(r.low_sessions);
  for (const a of ["member", "trainer", "manager"] as PtAudience[]) {
    const v = r.audiences?.[a];
    if (v) out.audiences[a] = { enabled: !!v.enabled, channels: Array.isArray(v.channels) ? v.channels : [] };
  }
  return out;
}

export interface PtPkg {
  id: string;
  member_id: string | null;
  status: string | null;
  expiry_date: string;
  sessions_total: number | null;
  sessions_remaining: number | null;
}

/** "d7" / "d0" for expiry cadence, "low" for low sessions, or null. */
export function ptReminderMark(pkg: PtPkg, today: string, daysBefore: number[], lowSessions: number): string | null {
  if (pkg.status !== "active") return null;
  const days = Math.round((Date.parse(pkg.expiry_date) - Date.parse(today)) / 86_400_000);
  if (daysBefore.includes(days)) return `d${days}`;
  const total = Number(pkg.sessions_total || 0);
  if (total > 0 && lowSessions > 0 && Number(pkg.sessions_remaining ?? 0) <= lowSessions && Number(pkg.sessions_remaining ?? 0) > 0) return "low";
  return null;
}

/** True when the member already has a newer live package covering this one. */
export function hasSuccessor(pkg: PtPkg, all: PtPkg[]): boolean {
  return all.some((r) => r.id !== pkg.id && r.member_id === pkg.member_id &&
    (r.status === "active" || r.status === "pending_payment") && Date.parse(r.expiry_date) > Date.parse(pkg.expiry_date));
}

export function ptDedupeKey(pkgId: string, audience: PtAudience, mark: string, channel: string): string {
  // "low" fires once per package; expiry marks fire once per day-mark.
  return `pt_expiry:${pkgId}:${audience}:${mark}:${channel}`;
}
