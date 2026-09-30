// scan-report-pdf v1.0.0 — Incline-branded body/posture scan report renderer.
//
// Produces a clinical-grade A4 report with brand header, identity strip,
// score hero, grouped metrics with healthy-range indicators, coaching
// targets, and an AI "your scan, explained" footer note.
//
// NOTE: this renderer is ONLY used when HOWBODY did not supply an original
// vendor PDF. Original vendor documents are always preserved untouched.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const A4: [number, number] = [595.28, 841.89];
const M = 40; // page margin

// Vuexy brand tokens
const INDIGO = rgb(0.31, 0.27, 0.9);
const VIOLET = rgb(0.49, 0.23, 0.93);
const DARK = rgb(0.06, 0.09, 0.16);
const SLATE = rgb(0.39, 0.45, 0.55);
const MUTED = rgb(0.58, 0.64, 0.72);
const LINE = rgb(0.89, 0.91, 0.94);
const CARD = rgb(0.98, 0.98, 0.99);
const WHITE = rgb(1, 1, 1);
const EMERALD = rgb(0.06, 0.72, 0.51);
const AMBER = rgb(0.96, 0.62, 0.04);
const RED = rgb(0.94, 0.27, 0.27);

export interface Band { low: number; high: number }
export interface Metric {
  label: string;
  value: number | null;
  suffix?: string;
  band?: Band;
  hint?: string;
}
export interface MetricGroup { title: string; metrics: Metric[] }

export interface ScanPdfInput {
  title: string;
  subtitle: string;
  memberName: string;
  memberCode?: string | null;
  branchName: string;
  scanDateLabel: string;
  facts: Array<[string, string]>;      // identity strip: Height, Age, Gender, Scan ID…
  score?: { value: number | null; label: string; caption: string };
  groups: MetricGroup[];
  plainRows?: Array<[string, string]>; // extra key/value rows (posture detail)
  aiNote?: string | null;
}

/** WinAnsi-safe text (StandardFonts cannot encode most Unicode). */
function win(x: unknown): string {
  return String(x ?? "")
    .replace(/\u20b9/g, "Rs.")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022\u00b7]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, "");
}

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "-";
  const n = Number(v);
  const s = Math.abs(n % 1) < 0.0001
    ? String(Math.round(n))
    : n.toFixed(Math.abs(n) < 2 ? 2 : 1);
  return suffix ? `${s} ${suffix}` : s;
}

function zoneOf(v: number | null, band?: Band): "low" | "normal" | "high" | null {
  if (v === null || v === undefined || !band || !Number.isFinite(v)) return null;
  if (v < band.low) return "low";
  if (v > band.high) return "high";
  return "normal";
}

const zoneColor = { low: AMBER, normal: EMERALD, high: RED } as const;
const zoneText = { low: "Below standard", normal: "Standard", high: "Above standard" } as const;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of win(text).split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export async function buildScanPdf(input: ScanPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0];
  const CONTENT = W - M * 2;

  const pages: PDFPage[] = [];
  let page = pdf.addPage(A4);
  pages.push(page);
  let y = 0;

  const text = (
    p: PDFPage, s: string, x: number, yy: number,
    size: number, f: PDFFont = font, color = DARK,
  ) => p.drawText(win(s), { x, y: yy, size, font: f, color });

  // ── Brand header band ───────────────────────────────────────────
  const drawHeader = (p: PDFPage, continued = false) => {
    const h = continued ? 58 : 108;
    p.drawRectangle({ x: 0, y: A4[1] - h, width: W, height: h, color: INDIGO });
    p.drawRectangle({ x: 0, y: A4[1] - h, width: W, height: 4, color: VIOLET });
    text(p, "THE INCLINE LIFE BY INCLINE", M, A4[1] - 28, 9, bold, WHITE);
    if (continued) {
      text(p, `${input.title} (continued)`, M, A4[1] - 46, 13, bold, WHITE);
    } else {
      text(p, input.title, M, A4[1] - 58, 22, bold, WHITE);
      text(p, input.subtitle, M, A4[1] - 76, 10, font, rgb(0.85, 0.85, 0.98));
      const right = `Scan: ${input.scanDateLabel}`;
      const rw = font.widthOfTextAtSize(win(right), 9);
      text(p, right, W - M - rw, A4[1] - 28, 9, font, rgb(0.85, 0.85, 0.98));
    }
    return A4[1] - h - 24;
  };

  const drawFooter = (p: PDFPage, idx: number, total: number) => {
    p.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.7, color: LINE });
    text(p, "Wellness reference generated from your in-club scan. Not a medical diagnosis.", M, 38, 8, font, MUTED);
    const pg = `Page ${idx} of ${total}`;
    const pw = font.widthOfTextAtSize(pg, 8);
    text(p, pg, W - M - pw, 38, 8, font, MUTED);
  };

  y = drawHeader(page);

  const need = (h: number) => {
    if (y - h < 78) {
      page = pdf.addPage(A4);
      pages.push(page);
      y = drawHeader(page, true);
    }
  };

  // ── Identity strip ──────────────────────────────────────────────
  const stripH = 54;
  page.drawRectangle({ x: M, y: y - stripH, width: CONTENT, height: stripH, color: CARD, borderColor: LINE, borderWidth: 0.8 });
  text(page, input.memberName, M + 14, y - 22, 13, bold, DARK);
  const meta = [input.memberCode, input.branchName].filter(Boolean).join("  -  ");
  text(page, meta, M + 14, y - 37, 9, font, SLATE);
  // facts on the right
  let fx = M + CONTENT - 14;
  for (const [label, value] of [...input.facts].reverse()) {
    const vw = Math.max(
      bold.widthOfTextAtSize(win(value), 11),
      font.widthOfTextAtSize(win(label.toUpperCase()), 7.5),
    );
    fx -= vw;
    text(page, label.toUpperCase(), fx, y - 18, 7.5, font, MUTED);
    text(page, value, fx, y - 34, 11, bold, DARK);
    fx -= 26;
  }
  y -= stripH + 20;

  // ── Score hero ──────────────────────────────────────────────────
  if (input.score && input.score.value !== null) {
    const h = 76;
    need(h + 16);
    page.drawRectangle({ x: M, y: y - h, width: CONTENT, height: h, color: rgb(0.95, 0.95, 1) });
    page.drawRectangle({ x: M, y: y - h, width: 4, height: h, color: VIOLET });
    text(page, String(Math.round(input.score.value)), M + 22, y - 50, 40, bold, INDIGO);
    const nw = bold.widthOfTextAtSize(String(Math.round(input.score.value)), 40);
    text(page, "/ 100", M + 26 + nw, y - 50, 12, font, MUTED);
    text(page, input.score.label.toUpperCase(), M + 22, y - 20, 8, bold, SLATE);
    const capLines = wrap(input.score.caption, font, 9.5, CONTENT - 200);
    let cy = y - 34;
    for (const l of capLines.slice(0, 4)) {
      text(page, l, M + 190, cy, 9.5, font, SLATE);
      cy -= 13;
    }
    y -= h + 22;
  }

  // ── Metric groups ───────────────────────────────────────────────
  const rowH = 30;
  for (const group of input.groups) {
    const rows = group.metrics.filter((m) => m.value !== null && m.value !== undefined);
    if (!rows.length) continue;

    // keep a group header with at least three of its rows
    need(30 + rowH * Math.min(rows.length, 3));
    text(page, group.title.toUpperCase(), M, y, 8.5, bold, INDIGO);
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: W - M, y: y - 7 }, thickness: 1, color: INDIGO });
    y -= 20;

    rows.forEach((m, i) => {
      need(rowH);
      if (i % 2 === 0) {
        page.drawRectangle({ x: M, y: y - rowH + 8, width: CONTENT, height: rowH, color: CARD });
      }
      const base = y - rowH + 19;
      text(page, m.label, M + 12, base, 10, font, SLATE);
      text(page, fmt(m.value, m.suffix), M + 190, base, 10.5, bold, DARK);

      const z = zoneOf(m.value, m.band);
      if (m.band && z) {
        // range bar
        const bx = M + 285;
        const bw = 130;
        const span = m.band.high - m.band.low;
        const min = m.band.low - span;
        const max = m.band.high + span;
        const pct = Math.min(1, Math.max(0, ((m.value as number) - min) / (max - min)));
        page.drawRectangle({ x: bx, y: base - 1, width: bw, height: 5, color: rgb(0.91, 0.93, 0.96) });
        page.drawRectangle({ x: bx + bw / 3, y: base - 1, width: bw / 3, height: 5, color: rgb(0.80, 0.94, 0.88) });
        page.drawCircle({ x: bx + bw * pct, y: base + 1.5, size: 3.6, color: zoneColor[z] });
        const tag = zoneText[z];
        text(page, tag, bx + bw + 9, base, 8, bold, zoneColor[z]);
        text(page, `Healthy ${m.band.low}-${m.band.high}${m.suffix ? ` ${m.suffix}` : ""}`, bx, base - 11, 7.5, font, MUTED);
      } else if (m.hint) {
        text(page, m.hint, M + 300, base, 8.5, font, MUTED);
      }
      y -= rowH;
    });
    y -= 12;
  }

  // ── Plain rows (posture detail) ─────────────────────────────────
  if (input.plainRows?.length) {
    need(30);
    text(page, "DETAILED MEASUREMENTS", M, y, 8.5, bold, INDIGO);
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: W - M, y: y - 7 }, thickness: 1, color: INDIGO });
    y -= 20;
    input.plainRows.forEach(([label, value], i) => {
      need(22);
      if (i % 2 === 0) page.drawRectangle({ x: M, y: y - 14, width: CONTENT, height: 22, color: CARD });
      text(page, label, M + 12, y - 8, 10, font, SLATE);
      text(page, value, M + 300, y - 8, 10, bold, DARK);
      y -= 22;
    });
    y -= 12;
  }

  // ── AI note ─────────────────────────────────────────────────────
  if (input.aiNote?.trim()) {
    const lines = wrap(input.aiNote, font, 9.5, CONTENT - 28);
    need(40 + lines.length * 13);
    const boxH = 34 + lines.length * 13;
    page.drawRectangle({ x: M, y: y - boxH, width: CONTENT, height: boxH, color: rgb(0.96, 0.96, 1), borderColor: rgb(0.82, 0.82, 0.97), borderWidth: 0.8 });
    page.drawRectangle({ x: M, y: y - boxH, width: 4, height: boxH, color: INDIGO });
    text(page, "YOUR SCAN, EXPLAINED", M + 16, y - 18, 8.5, bold, INDIGO);
    let ny = y - 34;
    for (const l of lines) {
      text(page, l, M + 16, ny, 9.5, font, DARK);
      ny -= 13;
    }
    y -= boxH + 16;
  }

  pages.forEach((p, i) => drawFooter(p, i + 1, pages.length));
  return await pdf.save();
}
