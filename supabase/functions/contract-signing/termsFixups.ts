// v1.0.0 — Render-time fixups for employment agreement text so older drafts
// still print the saved notice period and only the selected role's duties.

const ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const TENS = ["", "", "twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + words(n % 100) : "");
  return String(n);
}

const ROLE_HEADINGS: Record<string, RegExp> = {
  trainer: /###\s*[A-C]?\.?\s*FITNESS TRAINER/i,
  staff: /###\s*[A-C]?\.?\s*SALES (STAFF|EXECUTIVE)/i,
  manager: /###\s*[A-C]?\.?\s*MANAGER\b/i,
};

export function applyRoleAndNotice(terms: string, role: string, noticeDays: number): string {
  let out = terms;
  if (Number.isFinite(noticeDays) && noticeDays > 0 && noticeDays < 1000) {
    const d = Math.round(noticeDays);
    out = out.replace(/\b\d{1,3}\s*\([a-z\- ]+\)\s*days(?=[^\n]*notice)/gi, `${d} (${words(d)}) days`);
  }
  if (ROLE_HEADINGS[role]) {
    // Drop "### X. <OTHER ROLE>" blocks inside the responsibilities section.
    for (const [r, re] of Object.entries(ROLE_HEADINGS)) {
      if (r === role) continue;
      const m = out.match(re);
      if (!m || m.index === undefined) continue;
      const start = m.index;
      const rest = out.slice(start + m[0].length);
      const next = rest.search(/\n(###\s|---|##\s)/);
      const end = next < 0 ? out.length : start + m[0].length + next + 1;
      out = out.slice(0, start) + out.slice(end);
    }
    // Legacy appointment tick-boxes: keep only the ticked role.
    out = out.replace(/^\[\s?\]\s.*$\n?/gm, "");
    out = out.replace(/^\[x\]\s*/gim, "");
  }
  return out;
}
