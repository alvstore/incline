// scan-report-pdf-v2 v2.0.0 — visual Incline scan report.
// Posture: 4 scanner views with alignment overlays. Body: shaded segment body
// map + BMI scale. Both: range bars with plain meaning per value, structured AI
// analysis and a QR link to the online report. Only used when HOWBODY did not
// supply an original vendor PDF.
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb, degrees } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.3";
import { type GlossaryEntry, type Sex, type Zone, zoneFor } from "./scan-glossary.ts";

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const INDIGO = rgb(0.31, 0.27, 0.9);
const VIOLET = rgb(0.49, 0.23, 0.93);
const DARK = rgb(0.06, 0.09, 0.16);
const SLATE = rgb(0.39, 0.45, 0.55);
const MUTED = rgb(0.58, 0.64, 0.72);
const LINE = rgb(0.89, 0.91, 0.94);
const CARD = rgb(0.97, 0.97, 0.99);
const SOFT = rgb(0.95, 0.95, 1);
const WHITE = rgb(1, 1, 1);
const EMERALD = rgb(0.06, 0.72, 0.51);
const AMBER = rgb(0.96, 0.62, 0.04);
const RED = rgb(0.94, 0.27, 0.27);
const ZC = { low: AMBER, normal: EMERALD, high: RED } as const;
const ZT = { low: "Below range", normal: "In range", high: "Above range" } as const;

export interface AiAnalysis {
  summary: string;
  items: Array<{ term: string; value: string; status: string; explanation: string; why?: string }>;
  strengths: string[];
  focus: string[];
  plan: Array<{ week: string; actions: string[] }>;
  questions: string[];
}

export interface MetricRow { entry: GlossaryEntry; value: number | null }

export interface V2Input {
  kind: "body" | "posture";
  title: string;
  subtitle: string;
  memberName: string;
  memberCode?: string | null;
  branchName: string;
  scanDateLabel: string;
  sex: Sex;
  facts: Array<[string, string]>;
  score: { value: number | null; label: string } | null;
  kpis: Array<[string, string]>;
  verdict: string;
  metrics: MetricRow[];
  // posture
  views?: Array<{ label: string; url: string | null; note: string; zone: Zone | null; tilt?: number; mode?: "shoulder" | "lean" | "plumb" }>;
  circumferences?: Array<[string, number | null, number | null]>; // label, left/single, right
  // body
  segments?: { fat: number[]; muscle: number[]; muscleStd?: number[] | null } | null;
  bmi?: number | null;
  targets?: Array<[string, number | null, string]>;
  previous?: Array<[string, number | null, number | null, string]>; // label, before, now, unit
  ai: AiAnalysis | null;
  aiFallback?: string | null;
  onlineUrl?: string | null;
}

function win(x: unknown): string {
  return String(x ?? "")
    .replace(/\u20b9/g, "Rs.").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-").replace(/[\u2022]/g, "-").replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}
const f1 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "-" : (Math.abs(Number(v)) < 2 ? Math.round(Number(v) * 100) / 100 : Math.round(Number(v) * 10) / 10).toString();

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of win(text).split(/\n+/)) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const c = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(c, size) > maxW && line) { out.push(line); line = w; } else line = c;
    }
    if (line) out.push(line);
  }
  return out;
}

async function fetchImage(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const ctl = AbortSignal.timeout(8000);
    const res = await fetch(url, { signal: ctl });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
    return null;
  } catch { return null; }
}

export async function buildScanPdfV2(input: V2Input): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0];
  const CW = W - M * 2;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const T = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = DARK, p = page) =>
    p.drawText(win(s), { x, y: yy, size, font: f, color });

  const header = (first: boolean) => {
    const h = first ? 104 : 54;
    page.drawRectangle({ x: 0, y: A4[1] - h, width: W, height: h, color: INDIGO });
    page.drawRectangle({ x: 0, y: A4[1] - h, width: W, height: 4, color: VIOLET });
    T("THE INCLINE LIFE BY INCLINE", M, A4[1] - 26, 8.5, bold, WHITE);
    const r = `Scan: ${input.scanDateLabel}`;
    T(r, W - M - font.widthOfTextAtSize(win(r), 8.5), A4[1] - 26, 8.5, font, rgb(0.86, 0.86, 0.98));
    if (first) {
      T(input.title, M, A4[1] - 58, 22, bold, WHITE);
      T(input.subtitle, M, A4[1] - 76, 10, font, rgb(0.86, 0.86, 0.98));
    } else {
      T(`${input.title} - ${input.memberName}`, M, A4[1] - 44, 12, bold, WHITE);
    }
    y = A4[1] - h - 22;
  };
  const newPage = (first = false) => { page = pdf.addPage(A4); pages.push(page); header(first); };
  const need = (h: number) => { if (y - h < 70) newPage(); };
  const section = (title: string, sub?: string) => {
    need(sub ? 60 : 44);
    T(title.toUpperCase(), M, y, 9, bold, INDIGO);
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 1, color: INDIGO });
    y -= 18;
    if (sub) { for (const l of wrap(sub, font, 8.5, CW)) { T(l, M, y, 8.5, font, SLATE); y -= 11; } y -= 4; }
  };
  const para = (s: string, size = 9.5, color = DARK, indent = 0, f = font) => {
    for (const l of wrap(s, f, size, CW - indent)) { need(size + 4); T(l, M + indent, y, size, f, color); y -= size + 3.5; }
  };
  const badge = (label: string, x: number, yy: number, color: ReturnType<typeof rgb>) => {
    const w = bold.widthOfTextAtSize(win(label), 7.5) + 10;
    page.drawRectangle({ x, y: yy - 3, width: w, height: 12, color, opacity: 0.15 });
    T(label, x + 5, yy, 7.5, bold, color);
    return w;
  };

  newPage(true);

  // Identity strip
  page.drawRectangle({ x: M, y: y - 50, width: CW, height: 50, color: CARD, borderColor: LINE, borderWidth: 0.8 });
  T(input.memberName, M + 14, y - 21, 13, bold);
  T([input.memberCode, input.branchName].filter(Boolean).join("  -  "), M + 14, y - 36, 9, font, SLATE);
  let fx = M + CW - 14;
  for (const [l, v] of [...input.facts].reverse()) {
    const vw = Math.max(bold.widthOfTextAtSize(win(v), 11), font.widthOfTextAtSize(win(l.toUpperCase()), 7.5));
    fx -= vw;
    T(l.toUpperCase(), fx, y - 17, 7.5, font, MUTED);
    T(v, fx, y - 33, 11, bold);
    fx -= 24;
  }
  y -= 66;

  // Hero: gauge + KPI tiles + verdict
  const heroH = 128;
  page.drawRectangle({ x: M, y: y - heroH, width: CW, height: heroH, color: SOFT });
  const gx = M + 70, gy = y - 78, gr = 46;
  const sv = input.score?.value ?? null;
  for (let i = 0; i <= 60; i++) {
    const a = Math.PI - (Math.PI * i) / 60;
    const filled = sv !== null && i / 60 <= sv / 100;
    page.drawCircle({ x: gx + gr * Math.cos(a), y: gy + gr * Math.sin(a), size: 3.4, color: filled ? (sv! >= 80 ? EMERALD : sv! >= 60 ? AMBER : RED) : LINE });
  }
  const st = sv === null ? "-" : String(Math.round(sv));
  T(st, gx - bold.widthOfTextAtSize(st, 28) / 2, gy + 4, 28, bold, INDIGO);
  T("/ 100", gx - font.widthOfTextAtSize("/ 100", 8) / 2, gy - 8, 8, font, MUTED);
  const sl = (input.score?.label || "Score").toUpperCase();
  T(sl, gx - bold.widthOfTextAtSize(win(sl), 7.5) / 2, gy - 26, 7.5, bold, SLATE);
  // KPI tiles
  const kx0 = M + 150, kw = (CW - 150 - 12 - 8 * (input.kpis.length - 1)) / Math.max(1, input.kpis.length);
  input.kpis.forEach(([l, v], i) => {
    const kx = kx0 + i * (kw + 8);
    page.drawRectangle({ x: kx, y: y - 62, width: kw, height: 48, color: WHITE, borderColor: LINE, borderWidth: 0.6 });
    T(l.toUpperCase(), kx + 8, y - 28, 7, bold, MUTED);
    T(v, kx + 8, y - 50, 15, bold, DARK);
  });
  let vy = y - 80;
  for (const l of wrap(input.verdict, font, 9.5, CW - 162).slice(0, 4)) { T(l, kx0, vy, 9.5, font, SLATE); vy -= 12.5; }
  y -= heroH + 18;

  // Posture views with overlays
  if (input.views?.length) {
    section("3D scanner views", "Front, side and back views captured by the 3D scanner. Lines show your alignment against a perfect vertical.");
    const n = input.views.length;
    const pw = (CW - 8 * (n - 1)) / n;
    const ph = 190;
    need(ph + 40);
    const imgs = await Promise.all(input.views.map((v) => fetchImage(pdf, v.url)));
    input.views.forEach((v, i) => {
      const px = M + i * (pw + 8), py = y - ph;
      page.drawRectangle({ x: px, y: py, width: pw, height: ph, color: rgb(0.93, 0.94, 0.97) });
      const img = imgs[i];
      if (img) {
        const s = Math.min(pw / img.width, ph / img.height);
        const iw = img.width * s, ih = img.height * s;
        page.drawImage(img, { x: px + (pw - iw) / 2, y: py + (ph - ih) / 2, width: iw, height: ih });
      } else {
        T("Image unavailable", px + 8, py + ph / 2, 8, font, MUTED);
      }
      const cx = px + pw / 2;
      // perfect vertical reference
      for (let d = py + 6; d < py + ph - 6; d += 8) page.drawLine({ start: { x: cx, y: d }, end: { x: cx, y: d + 4 }, thickness: 0.7, color: INDIGO, opacity: 0.8 });
      const col = v.zone ? ZC[v.zone] : INDIGO;
      const tilt = Math.max(-12, Math.min(12, (v.tilt ?? 0) * 3)) * Math.PI / 180; // exaggerated x3 for visibility
      if (v.mode === "shoulder") {
        const sy = py + ph * 0.74, half = pw * 0.32;
        page.drawLine({ start: { x: cx - half, y: sy - Math.tan(tilt) * half }, end: { x: cx + half, y: sy + Math.tan(tilt) * half }, thickness: 1.6, color: col });
        page.drawCircle({ x: cx - half, y: sy - Math.tan(tilt) * half, size: 2.5, color: col });
        page.drawCircle({ x: cx + half, y: sy + Math.tan(tilt) * half, size: 2.5, color: col });
      } else if (v.mode === "lean") {
        const by = py + 10, len = ph - 26;
        page.drawLine({ start: { x: cx, y: by }, end: { x: cx + Math.sin(tilt) * len, y: by + Math.cos(tilt) * len }, thickness: 1.6, color: col });
      } else {
        page.drawCircle({ x: cx + Math.max(-pw * 0.3, Math.min(pw * 0.3, (v.tilt ?? 0) * 4)), y: py + ph * 0.86, size: 3.2, color: col });
      }
      T(v.label.toUpperCase(), px + 6, py + ph - 12, 7, bold, DARK);
      for (const [k, l] of wrap(v.note, font, 7.5, pw - 4).slice(0, 2).entries()) T(l, px + 2, py - 11 - k * 9.5, 7.5, k ? font : bold, k ? SLATE : col);
    });
    y -= ph + 34;
    para("Lines are exaggerated 3x so small differences are visible. Open the online report for the rotating 3D model.", 7.5, MUTED);
    y -= 8;
  }

  // Body segment map
  if (input.segments) {
    section("3D segment body map", "Muscle and fat measured separately in each arm, each leg and the trunk. Colour shows muscle against the standard for your height.");
    const h = 290;
    need(h + 10);
    const cx = M + 120, top = y - 10;
    const labels = ["Left arm", "Right arm", "Trunk", "Left leg", "Right leg"];
    const tone = (i: number) => {
      const std = input.segments!.muscleStd?.[i];
      if (!std) return EMERALD;
      const r = input.segments!.muscle[i] / std;
      return r < 0.9 ? AMBER : r > 1.1 ? INDIGO : EMERALD;
    };
    // shapes: [x, y(top), w, h]
    const shapes: Array<[number, number, number, number]> = [
      [cx + 34, top - 46, 16, 82], // left arm (viewer right = member left)
      [cx - 50, top - 46, 16, 82],
      [cx - 30, top - 42, 60, 92],
      [cx + 3, top - 136, 24, 92],
      [cx - 27, top - 136, 24, 92],
    ];
    const depth = (x: number, yy: number, w: number, hh: number, c: ReturnType<typeof rgb>) => {
      page.drawRectangle({ x: x + 4, y: yy - hh - 4, width: w, height: hh, color: DARK, opacity: 0.12 });
      page.drawRectangle({ x, y: yy - hh, width: w, height: hh, color: c, opacity: 0.85 });
      page.drawRectangle({ x, y: yy - hh, width: w * 0.3, height: hh, color: WHITE, opacity: 0.18 });
    };
    page.drawCircle({ x: cx + 3, y: top - 14, size: 14, color: DARK, opacity: 0.12 });
    page.drawCircle({ x: cx, y: top - 10, size: 14, color: rgb(0.8, 0.82, 0.9) });
    shapes.forEach(([x, yy, w, hh], i) => depth(x, yy - 18, w, hh, tone(i)));
    // table
    const tx = M + 250;
    let ty = top - 4;
    T("SEGMENT", tx, ty, 7.5, bold, MUTED); T("MUSCLE", tx + 110, ty, 7.5, bold, MUTED); T("FAT", tx + 170, ty, 7.5, bold, MUTED); T("STATUS", tx + 220, ty, 7.5, bold, MUTED);
    ty -= 16;
    labels.forEach((l, i) => {
      page.drawRectangle({ x: tx - 6, y: ty - 6, width: CW - 250 + 6, height: 22, color: i % 2 ? WHITE : CARD });
      page.drawCircle({ x: tx, y: ty + 3, size: 3.5, color: tone(i) });
      T(l, tx + 9, ty, 9.5);
      T(`${f1(input.segments!.muscle[i])} kg`, tx + 110, ty, 9.5, bold);
      T(`${f1(input.segments!.fat[i])} kg`, tx + 170, ty, 9.5, bold);
      const c = tone(i);
      badge(c === AMBER ? "Build" : c === INDIGO ? "Strong" : "Balanced", tx + 220, ty, c);
      ty -= 24;
    });
    const lm = input.segments.muscle, imb = Math.abs(lm[0] - lm[1]) / Math.max(lm[0], lm[1]) * 100, legImb = Math.abs(lm[3] - lm[4]) / Math.max(lm[3], lm[4]) * 100;
    ty -= 6;
    for (const l of wrap(`Left/right balance: arms ${f1(imb)}% apart, legs ${f1(legImb)}% apart (under 5% is well balanced).`, font, 8.5, CW - 250)) { T(l, tx, ty, 8.5, font, SLATE); ty -= 11; }
    y -= h;
  }

  // BMI scale
  if (input.bmi) {
    section("BMI assessment");
    need(50);
    const bands: Array<[string, number, number, ReturnType<typeof rgb>]> = [
      ["Underweight", 12, 18.5, AMBER], ["Normal", 18.5, 25, EMERALD], ["Overweight", 25, 30, AMBER], ["Obese", 30, 40, RED],
    ];
    const bx = M, bw = CW, min = 12, max = 40;
    for (const [l, a, b, c] of bands) {
      const x = bx + ((a - min) / (max - min)) * bw, w = ((b - a) / (max - min)) * bw;
      page.drawRectangle({ x, y: y - 14, width: w, height: 10, color: c, opacity: 0.35 });
      T(l, x + 3, y - 28, 7.5, font, SLATE);
    }
    const mx = bx + Math.min(1, Math.max(0, (input.bmi - min) / (max - min))) * bw;
    page.drawRectangle({ x: mx - 1, y: y - 18, width: 2, height: 18, color: DARK });
    T(`You: ${f1(input.bmi)}`, Math.min(mx - 14, W - M - 50), y + 4, 8.5, bold);
    y -= 44;
    para("BMI uses only height and weight, so muscular members can read high. Use body fat % and the segment map above for the full picture.", 8, MUTED);
    y -= 6;
  }

  // Metric table
  section("Every value, explained", "Each result with its unit, reference range, where you sit, and what it means.");
  for (const m of input.metrics) {
    if (m.value === null) continue;
    const meaning = wrap(m.entry.meaning, font, 7.8, 250);
    const rh = 22 + meaning.length * 9.5;
    need(rh);
    page.drawRectangle({ x: M, y: y - rh + 12, width: CW, height: rh, color: CARD });
    T(m.entry.label, M + 10, y, 10, bold);
    T(`${f1(m.value)}${m.entry.unit ? ` ${m.entry.unit}` : ""}`, M + 150, y, 10.5, bold, INDIGO);
    meaning.forEach((l, k) => T(l, M + 10, y - 12 - k * 9.5, 7.8, font, SLATE));
    const b = m.entry.band?.(input.sex);
    const z = zoneFor(m.entry, m.value, input.sex);
    if (b && z) {
      const bx = M + 290, bw = 140;
      const span = Math.max(0.001, b.high - b.low);
      const lo = b.low - span, hi = b.high + span;
      const v = m.entry.absolute ? Math.abs(m.value) : m.value;
      const pct = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      page.drawRectangle({ x: bx, y: y - 1, width: bw, height: 6, color: rgb(0.9, 0.92, 0.95) });
      page.drawRectangle({ x: bx + bw / 3, y: y - 1, width: bw / 3, height: 6, color: EMERALD, opacity: 0.3 });
      page.drawCircle({ x: bx + bw * pct, y: y + 2, size: 4, color: ZC[z] });
      T(`Range ${m.entry.absolute ? "0" : f1(b.low)}-${f1(b.high)}${m.entry.unit ? ` ${m.entry.unit}` : ""}${m.entry.absolute ? " either side" : ""}`, bx, y - 12, 7, font, MUTED);
      badge(ZT[z], bx + bw + 8, y, ZC[z]);
    }
    y -= rh + 2;
  }
  y -= 8;

  if (input.circumferences?.length) {
    section("Body circumferences", "Measured from the 3D model. Left/right differences over 1.5 cm are highlighted.");
    input.circumferences.forEach(([l, a, b], i) => {
      need(20);
      if (i % 2 === 0) page.drawRectangle({ x: M, y: y - 6, width: CW, height: 20, color: CARD });
      T(l, M + 10, y, 9.5, font, SLATE);
      if (b === null) T(`${f1(a)} cm`, M + 200, y, 9.5, bold);
      else {
        T(`L ${f1(a)} cm   R ${f1(b)} cm`, M + 200, y, 9.5, bold);
        if (a !== null && Math.abs(a - b) > 1.5) badge(`${f1(Math.abs(a - b))} cm difference`, M + 350, y, AMBER);
      }
      y -= 20;
    });
    y -= 8;
  }

  if (input.targets?.some((t) => t[1] !== null)) {
    section("Your targets");
    for (const [l, v, hint] of input.targets) {
      if (v === null) continue;
      need(20);
      const arrow = v > 0 ? "+" : "";
      T(l, M + 10, y, 9.5, font, SLATE);
      T(`${arrow}${f1(v)} kg`, M + 200, y, 10, bold, v === 0 ? EMERALD : INDIGO);
      T(hint, M + 280, y, 8, font, MUTED);
      y -= 20;
    }
    y -= 8;
  }

  if (input.previous?.length) {
    section("Since your last scan");
    for (const [l, a, b, u] of input.previous) {
      if (a === null || b === null) continue;
      need(20);
      const d = b - a;
      T(l, M + 10, y, 9.5, font, SLATE);
      T(`${f1(a)} -> ${f1(b)} ${u}`, M + 200, y, 9.5, bold);
      T(`${d > 0 ? "+" : ""}${f1(d)} ${u}`, M + 340, y, 9.5, bold, Math.abs(d) < 0.1 ? MUTED : INDIGO);
      y -= 20;
    }
    y -= 8;
  }

  // AI analysis
  const ai = input.ai;
  if (ai) {
    newPage();
    section("AI coach analysis", "Your scan, read value by value by the Incline AI coach. Wellness guidance only, not a medical diagnosis.");
    const sl2 = wrap(ai.summary, font, 10, CW - 28);
    const sh = 22 + sl2.length * 13.5;
    need(sh);
    page.drawRectangle({ x: M, y: y - sh + 10, width: CW, height: sh, color: SOFT });
    page.drawRectangle({ x: M, y: y - sh + 10, width: 4, height: sh, color: INDIGO });
    T("SUMMARY", M + 14, y - 4, 8, bold, INDIGO);
    sl2.forEach((l, k) => T(l, M + 14, y - 19 - k * 13.5, 10, font, DARK));
    y -= sh + 10;

    if (ai.items.length) {
      section("What each result means for you");
      for (const it of ai.items) {
        need(40);
        const s = it.status.toLowerCase();
        const c = s.includes("above") || s.includes("high") ? RED : s.includes("below") || s.includes("low") || s.includes("watch") ? AMBER : EMERALD;
        T(`${it.term}`, M, y, 10, bold);
        const tw = bold.widthOfTextAtSize(win(it.term), 10);
        T(it.value, M + tw + 8, y, 9.5, bold, INDIGO);
        badge(it.status, M + tw + 16 + bold.widthOfTextAtSize(win(it.value), 9.5), y, c);
        y -= 13;
        para(it.explanation, 8.8, SLATE, 0);
        if (it.why) para(`Why it matters: ${it.why}`, 8.5, MUTED, 0);
        y -= 6;
      }
    }

    const list = (title: string, items: string[], color: ReturnType<typeof rgb>) => {
      if (!items.length) return;
      section(title);
      for (const s of items) {
        const lines = wrap(s, font, 9, CW - 16);
        need(lines.length * 12.5 + 2);
        page.drawCircle({ x: M + 4, y: y + 3, size: 2.4, color });
        lines.forEach((l, k) => T(l, M + 14, y - k * 12.5, 9, font, DARK));
        y -= lines.length * 12.5 + 3;
      }
      y -= 6;
    };
    list("Strengths", ai.strengths, EMERALD);
    list("Focus areas", ai.focus, AMBER);
    if (ai.plan.length) {
      section("Your 4-week plan");
      for (const w of ai.plan) {
        need(30);
        T(w.week, M, y, 9.5, bold, INDIGO);
        y -= 13;
        for (const a of w.actions) {
          const lines = wrap(a, font, 9, CW - 16);
          need(lines.length * 12.5);
          T("-", M + 6, y, 9, bold, SLATE);
          lines.forEach((l, k) => T(l, M + 14, y - k * 12.5, 9, font, DARK));
          y -= lines.length * 12.5 + 2;
        }
        y -= 6;
      }
    }
    list("Ask your trainer", ai.questions, INDIGO);
  } else if (input.aiFallback) {
    section("Your scan, explained");
    para(input.aiFallback, 9.5);
  }

  // QR online
  if (input.onlineUrl) {
    try {
      const qr = QRCode.create(input.onlineUrl, { errorCorrectionLevel: "M" });
      const size = qr.modules.size;
      const box = 84, cell = box / size;
      need(box + 30);
      y -= 6;
      page.drawRectangle({ x: M, y: y - box - 16, width: CW, height: box + 20, color: SOFT });
      const qx = M + 10, qy = y - box - 10;
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c)) page.drawRectangle({ x: qx + c * cell, y: qy + (size - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: DARK });
      }
      T("View your report online", qx + box + 18, y - 22, 13, bold, INDIGO);
      for (const [k, l] of wrap("Scan the code with your phone camera to open the interactive report with your 3D body model. The link is private to you and expires in 30 days.", font, 9, CW - box - 40).entries()) T(l, qx + box + 18, y - 40 - k * 12, 9, font, SLATE);
      y -= box + 30;
    } catch (e) { console.warn("qr failed", e); }
  }

  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 48 }, end: { x: W - M, y: 48 }, thickness: 0.7, color: LINE });
    T("Wellness reference generated from your in-club 3D scan. Not a medical diagnosis.", M, 35, 7.5, font, MUTED, p);
    const pg = `Page ${i + 1} of ${total}`;
    T(pg, W - M - font.widthOfTextAtSize(pg, 7.5), 35, 7.5, font, MUTED, p);
  });
  void degrees;
  return await pdf.save();
}
