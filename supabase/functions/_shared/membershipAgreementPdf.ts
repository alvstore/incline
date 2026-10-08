// membershipAgreementPdf v1.0.0 — THE canonical renderer for the Incline
// Membership Registration & Agreement (Parts A–I).
//
// ONE document · ONE signature · ONE stored PDF. Every copy a member or staff
// member ever sees (stored at sign time, backfilled, viewed, printed,
// downloaded) comes out of this function, so they are always identical.
//
// Header:  THE INCLINE LIFE BY INCLINE
//          MEMBERSHIP REGISTRATION & AGREEMENT
//          <Branch>  |  AGR-<member code>  |  Signed <date>
// The agreement version is written to PDF metadata only — never printed.
import {
  degrees,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";
import {
  AGREEMENT_ACKNOWLEDGEMENTS,
  AGREEMENT_LEGAL_NAME,
  AGREEMENT_PARQ_QUESTIONS,
  AGREEMENT_PARTS,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
  agreementReference,
  FINAL_DECLARATION,
  normaliseParq,
} from "./agreement.ts";
import { inclineLogoBytes } from "./incline-logo.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AgreementMemberData {
  name: string;
  code: string | null;
  memberId?: string | null;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  governmentIdType?: string | null;
  governmentIdNumber?: string | null;
  fitnessGoals?: string | null;
  healthConditions?: string | null;
}

export interface AgreementMembershipData {
  planName?: string | null;
  /** Amount paid for the plan in INR (member's own record). */
  amount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  /** Plan the member expressed interest in before buying (self-registration). */
  planInterest?: string | null;
  registeredOn?: string | null;
}

export interface AgreementBranchData {
  name: string;
  phone?: string | null;
  email?: string | null;
}

export interface AgreementBrandData {
  legalName?: string;
  website?: string;
  supportEmail?: string;
  /** Optional branch/organisation logo (PNG or JPEG bytes). Falls back to the Incline wordmark. */
  logoBytes?: Uint8Array | null;
}

export interface AgreementSignatureData {
  pngBytes: Uint8Array | null;
  signedAt: string | null;
  ip?: string | null;
}

export interface AgreementRenderInput {
  member: AgreementMemberData;
  membership?: AgreementMembershipData | null;
  branch: AgreementBranchData;
  brand?: AgreementBrandData | null;
  parq?: Record<string, unknown> | null;
  /** Acknowledgement key → accepted. Resolve with `acknowledgementsFromSignedRecord` for signed records. */
  acknowledgements: Record<string, boolean>;
  customTerms?: string | null;
  /** `null` renders an unsigned DRAFT (watermarked, no signature block image). */
  signature: AgreementSignatureData | null;
  generatedAt?: Date;
}

// ---------------------------------------------------------------------------
// Layout constants (points, A4)
// ---------------------------------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const CONTENT_W = PAGE_W - M * 2;
const HEADER_H = 92;
const FOOTER_H = 34;
const BOTTOM_LIMIT = FOOTER_H + 14;

const INDIGO = rgb(79 / 255, 70 / 255, 229 / 255);
const VIOLET = rgb(124 / 255, 58 / 255, 237 / 255);
const INDIGO_50 = rgb(238 / 255, 242 / 255, 255 / 255);
const INK = rgb(15 / 255, 23 / 255, 42 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const LINE = rgb(226 / 255, 232 / 255, 240 / 255);
const CARD = rgb(248 / 255, 250 / 255, 252 / 255);
const WHITE = rgb(1, 1, 1);
const HEADER_SOFT = rgb(226 / 255, 232 / 255, 240 / 255);
const GREEN = rgb(22 / 255, 163 / 255, 74 / 255);
const AMBER = rgb(217 / 255, 119 / 255, 6 / 255);
const SLATE_400 = rgb(148 / 255, 163 / 255, 184 / 255);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
/** WinAnsi-safe text — pdf-lib standard fonts cannot encode arbitrary Unicode. */
export function winAnsi(x: unknown): string {
  return String(x ?? "")
    .replace(/\u20b9\s?/g, "Rs. ")
    .replace(/[\u2713\u2714\u2705]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2012\u2212]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, "");
}

const IST = "Asia/Kolkata";
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" }).format(d);
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = fmtDate(iso);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date}, ${time} IST`;
}
function fmtInr(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  return `Rs. ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function titleCaseId(t?: string | null): string {
  if (!t) return "";
  return t.replace(/_/g, " ").toUpperCase();
}

function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxW) { line = candidate; continue; }
      if (line) out.push(line);
      // Very long tokens (URLs, IDs): hard-break by character.
      if (font.widthOfTextAtSize(word, size) > maxW) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxW) { out.push(chunk); chunk = ch; }
          else chunk += ch;
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
export async function renderMembershipAgreementPdf(input: AgreementRenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const legalName = input.brand?.legalName || "The Incline Life by Incline";
  const website = input.brand?.website || "theincline.in";
  const supportEmail = input.brand?.supportEmail || "info@theinclinelife.com";
  const ref = agreementReference(input.member.code, input.member.memberId);
  const isDraft = !input.signature;
  const signedAt = input.signature?.signedAt ?? null;
  const generatedAt = input.generatedAt ?? new Date();

  pdf.setTitle(`${AGREEMENT_TITLE} — ${ref}`);
  pdf.setSubject(`${legalName} · agreement version ${AGREEMENT_VERSION}${isDraft ? " · DRAFT (unsigned)" : ""}`);
  pdf.setAuthor(legalName);
  pdf.setKeywords([ref, AGREEMENT_VERSION, "membership agreement", input.branch.name]);
  pdf.setCreator("Incline");
  pdf.setProducer("Incline");
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  // Logo: organisation/branch logo when provided, else the embedded wordmark.
  let logo: PDFImage | null = null;
  const tryEmbed = async (bytes: Uint8Array | null | undefined) => {
    if (!bytes || !bytes.length) return null;
    try { return await pdf.embedPng(bytes); } catch { /* not png */ }
    try { return await pdf.embedJpg(bytes); } catch { return null; }
  };
  logo = await tryEmbed(input.brand?.logoBytes ?? null);
  if (!logo) logo = await tryEmbed(inclineLogoBytes());

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  const text = (
    s: string,
    x: number,
    yy: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; maxW?: number } = {},
  ) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 9;
    const str = winAnsi(s);
    let xx = x;
    if (opts.align === "right") xx = x - f.widthOfTextAtSize(str, size);
    else if (opts.align === "center") xx = x - f.widthOfTextAtSize(str, size) / 2;
    page.drawText(str, { x: xx, y: yy, size, font: f, color: opts.color ?? INK });
  };

  const roundedRect = (x: number, top: number, w: number, h: number, r: number, color: ReturnType<typeof rgb>) => {
    const rr = Math.min(r, h / 2, w / 2);
    const d =
      `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} ` +
      `H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
    page.drawSvgPath(d, { x, y: top, color, borderWidth: 0 });
  };

  const drawHeaderBand = () => {
    const strips = 64;
    const stripW = PAGE_W / strips;
    for (let i = 0; i < strips; i++) {
      const t = i / (strips - 1);
      page.drawRectangle({
        x: stripW * i,
        y: PAGE_H - HEADER_H,
        width: stripW + 0.4,
        height: HEADER_H,
        color: rgb(
          79 / 255 + (124 / 255 - 79 / 255) * t,
          70 / 255 + (58 / 255 - 70 / 255) * t,
          229 / 255 + (237 / 255 - 229 / 255) * t,
        ),
      });
    }
    page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H - 1.5, width: PAGE_W, height: 1.5, color: VIOLET });

    let textX = M;
    if (logo) {
      const maxH = 34, maxW = 66;
      const ratio = logo.width / Math.max(1, logo.height);
      let lh = maxH, lw = lh * ratio;
      if (lw > maxW) { lw = maxW; lh = lw / ratio; }
      const pad = 7;
      const boxW = lw + pad * 2, boxH = lh + pad * 2;
      const boxTop = PAGE_H - (HEADER_H - boxH) / 2;
      roundedRect(M, boxTop, boxW, boxH, 5, WHITE);
      page.drawImage(logo, { x: M + pad, y: boxTop - pad - lh, width: lw, height: lh });
      textX = M + boxW + 16;
    }

    text(AGREEMENT_LEGAL_NAME, textX, PAGE_H - 36, { font: bold, size: 16, color: WHITE });
    text(AGREEMENT_TITLE, textX, PAGE_H - 53, { font: bold, size: 11.5, color: rgb(0.93, 0.94, 1) });
    const refLine = [
      input.branch.name,
      ref,
      isDraft ? "DRAFT - not yet signed" : `Signed ${fmtDate(signedAt)}`,
    ].filter(Boolean).join("   |   ");
    text(refLine, textX, PAGE_H - 69, { size: 8.8, color: HEADER_SOFT });

    // Member identity block, right-aligned.
    text(input.member.name, PAGE_W - M, PAGE_H - 38, { font: bold, size: 10.5, color: WHITE, align: "right" });
    if (input.member.code) {
      text(`Member ${input.member.code}`, PAGE_W - M, PAGE_H - 52, { size: 9, color: HEADER_SOFT, align: "right" });
    }
    const contact = [input.branch.phone, input.branch.email].filter(Boolean).join("  ·  ");
    if (contact) text(contact, PAGE_W - M, PAGE_H - 66, { size: 8, color: HEADER_SOFT, align: "right" });
  };

  const drawDraftWatermark = (p: PDFPage) => {
    p.drawText("DRAFT  -  NOT SIGNED", {
      x: 110,
      y: 290,
      size: 44,
      font: bold,
      color: AMBER,
      opacity: 0.08,
      rotate: degrees(32),
    });
  };

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 44;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM_LIMIT) newPage();
  };

  drawHeaderBand();
  y = PAGE_H - HEADER_H - 22;

  // -- Building blocks ------------------------------------------------------
  const partHeading = (id: string, title: string, intro?: string) => {
    ensure(intro ? 42 : 30);
    roundedRect(M, y, CONTENT_W, 19, 4, INDIGO_50);
    text(`PART ${id} — ${title.toUpperCase()}`, M + 9, y - 13, { font: bold, size: 9.2, color: INDIGO });
    y -= 26;
    if (intro) {
      text(intro, M + 2, y, { font: italic, size: 7.8, color: MUTED });
      y -= 13;
    }
  };

  const fieldRows = (rows: Array<[string, string | null | undefined]>) => {
    const labelW = 128;
    const valueX = M + 8 + labelW;
    const valueW = CONTENT_W - labelW - 16;
    const lh = 11.5;
    for (const [label, raw] of rows) {
      const value = raw && String(raw).trim() ? String(raw) : "—";
      const lines = wrapText(value, font, 9, valueW);
      const rowH = Math.max(1, lines.length) * lh + 6;
      ensure(rowH + 2);
      text(label, M + 8, y - 9, { font: bold, size: 8.4, color: MUTED });
      lines.forEach((ln, i) => text(ln, valueX, y - 9 - i * lh, { size: 9, color: INK }));
      page.drawLine({ start: { x: M + 4, y: y - rowH }, end: { x: M + CONTENT_W - 4, y: y - rowH }, thickness: 0.5, color: LINE });
      y -= rowH;
    }
    y -= 8;
  };

  const parqTable = (parq: Record<string, "yes" | "no">) => {
    const colNo = 22, colAns = 54;
    const colQ = CONTENT_W - colNo - colAns;
    const headH = 17, rowH = 15;
    ensure(headH + rowH * 2);
    const drawHead = () => {
      roundedRect(M, y, CONTENT_W, headH, 3, INDIGO);
      text("#", M + 8, y - 11.5, { font: bold, size: 8.4, color: WHITE });
      text("PAR-Q Question", M + colNo + 6, y - 11.5, { font: bold, size: 8.4, color: WHITE });
      text("Answer", M + CONTENT_W - colAns / 2, y - 11.5, { font: bold, size: 8.4, color: WHITE, align: "center" });
      y -= headH;
    };
    drawHead();
    AGREEMENT_PARQ_QUESTIONS.forEach((q, i) => {
      if (y - rowH < BOTTOM_LIMIT) { newPage(); drawHead(); }
      if (i % 2 === 0) page.drawRectangle({ x: M, y: y - rowH, width: CONTENT_W, height: rowH, color: CARD });
      const ans = parq[q] === "yes" ? "YES" : "NO";
      text(String(i + 1), M + 8, y - 10.5, { size: 8.4, color: MUTED });
      const qLines = wrapText(q, font, 8.4, colQ - 10);
      text(qLines[0] ?? "", M + colNo + 6, y - 10.5, { size: 8.4, color: INK });
      text(ans, M + CONTENT_W - colAns / 2, y - 10.5, {
        font: bold, size: 8.4, color: ans === "YES" ? AMBER : INK, align: "center",
      });
      y -= rowH;
    });
    page.drawLine({ start: { x: M, y }, end: { x: M + CONTENT_W, y }, thickness: 0.6, color: LINE });
    y -= 12;
  };

  const clauseList = (clauses: Array<{ title: string; body: string }>, startAt = 1) => {
    const lh = 10.2;
    clauses.forEach((c, i) => {
      const bodyLines = wrapText(c.body, font, 8.2, CONTENT_W - 14);
      ensure(lh * 2 + 4);
      text(`${startAt + i}. ${c.title}`, M + 4, y - 8, { font: bold, size: 8.6, color: INK });
      y -= lh + 1;
      for (const ln of bodyLines) {
        ensure(lh);
        text(ln, M + 10, y - 8, { size: 8.2, color: INK });
        y -= lh;
      }
      y -= 5;
    });
  };

  const acknowledgementList = (partId: string) => {
    const items = AGREEMENT_ACKNOWLEDGEMENTS.filter((a) => a.part === partId);
    if (!items.length) return;
    y -= 2;
    for (const a of items) {
      const granted = input.acknowledgements[a.key] === true;
      const lines = wrapText(a.label, font, 8.2, CONTENT_W - 28);
      const h = lines.length * 10.2 + 4;
      ensure(h + 14);
      const boxSize = 9;
      const boxTop = y - 1;
      page.drawRectangle({
        x: M + 6, y: boxTop - boxSize, width: boxSize, height: boxSize,
        borderColor: granted ? GREEN : SLATE_400, borderWidth: granted ? 1 : 0.7,
        color: granted ? rgb(220 / 255, 252 / 255, 231 / 255) : WHITE,
      });
      if (granted) {
        page.drawLine({ start: { x: M + 8, y: boxTop - 5 }, end: { x: M + 10.2, y: boxTop - 7.4 }, thickness: 1.4, color: GREEN });
        page.drawLine({ start: { x: M + 10.2, y: boxTop - 7.4 }, end: { x: M + 13.6, y: boxTop - 2.2 }, thickness: 1.4, color: GREEN });
      }
      lines.forEach((ln, i) => text(ln, M + 22, y - 8 - i * 10.2, { size: 8.2, color: granted ? INK : MUTED }));
      if (!granted) {
        text(a.required ? "PENDING" : "NOT GIVEN", M + CONTENT_W - 4, y - 8, {
          font: bold, size: 6.8, color: a.required ? AMBER : MUTED, align: "right",
        });
      }
      y -= h;
    }
    y -= 4;
  };

  // -- Parts A–I --------------------------------------------------------------
  const parq = normaliseParq(input.parq ?? null);
  const m = input.member;
  const ms = input.membership ?? null;

  for (const part of AGREEMENT_PARTS) {
    partHeading(part.id, part.title, part.intro);

    if (part.id === "A") {
      fieldRows([
        ["Full Name", m.name],
        ["Member Code", m.code ?? ""],
        ["Email", m.email ?? ""],
        ["Phone", m.phone ?? ""],
        ["Gender", m.gender ? m.gender.charAt(0).toUpperCase() + m.gender.slice(1) : ""],
        ["Date of Birth", fmtDate(m.dateOfBirth)],
        ["Address", [m.address, m.city, m.state, m.postalCode].filter(Boolean).join(", ")],
        ["Government ID", [titleCaseId(m.governmentIdType), m.governmentIdNumber].filter(Boolean).join(" · ")],
        ["Emergency Contact", [m.emergencyContactName, m.emergencyContactPhone].filter(Boolean).join(" · ")],
      ]);
    }

    if (part.id === "B") {
      const rows: Array<[string, string | null | undefined]> = [["Branch", input.branch.name]];
      if (ms?.planName || ms?.startDate || ms?.endDate || (ms?.amount ?? null) !== null) {
        rows.push(
          ["Plan", ms?.planName ?? ""],
          ["Amount", fmtInr(ms?.amount)],
          ["Start Date", fmtDate(ms?.startDate)],
          ["End Date", fmtDate(ms?.endDate)],
        );
      } else {
        rows.push(
          ["Plan", ms?.planInterest ? `Interest noted: ${ms.planInterest}` : "To be activated at reception"],
          ["Registered On", fmtDate(ms?.registeredOn ?? signedAt)],
        );
      }
      fieldRows(rows);
    }

    if (part.id === "C") {
      fieldRows([
        ["Primary Fitness Goal", m.fitnessGoals ?? ""],
        ["Health Conditions / Injuries", m.healthConditions?.trim() ? m.healthConditions : "None declared"],
      ]);
      parqTable(parq);
    }

    clauseList(part.clauses);

    if (part.id === "E" && input.customTerms && input.customTerms.trim()) {
      clauseList([{ title: "Member-Specific Addendum", body: input.customTerms.trim() }], part.clauses.length + 1);
    }

    acknowledgementList(part.id);

    if (part.id === "I") {
      const declLines = wrapText(FINAL_DECLARATION, italic, 8.6, CONTENT_W - 8);
      ensure(declLines.length * 10.6 + 6);
      declLines.forEach((ln) => { text(ln, M + 4, y - 8, { font: italic, size: 8.6, color: INK }); y -= 10.6; });
      y -= 10;

      // Signature block
      const colW = (CONTENT_W - 24) / 2;
      const leftX = M + 2;
      const rightX = M + colW + 24;
      let sigImg: PDFImage | null = null;
      if (!isDraft) sigImg = await tryEmbed(input.signature!.pngBytes);
      const sigH = sigImg ? Math.min(60, (Math.min(colW - 10, 200) / sigImg.width) * sigImg.height) : 60;
      const blockH = 16 + sigH + 30;
      ensure(blockH + 24);

      text("MEMBER SIGNATURE", leftX, y - 8, { font: bold, size: 8, color: MUTED });
      text("AUTHORIZED STAFF", rightX, y - 8, { font: bold, size: 8, color: MUTED });
      y -= 16;

      if (sigImg) {
        const w = (sigH / sigImg.height) * sigImg.width;
        page.drawImage(sigImg, { x: leftX + 4, y: y - sigH, width: w, height: sigH });
      } else if (!isDraft) {
        page.drawRectangle({
          x: leftX, y: y - sigH, width: colW, height: sigH,
          borderColor: GREEN, borderWidth: 0.8, color: rgb(240 / 255, 253 / 255, 244 / 255),
        });
        text("Signed digitally", leftX + colW / 2, y - sigH / 2 + 3, { font: bold, size: 9, color: GREEN, align: "center" });
        text("(signature image on file could not be reproduced)", leftX + colW / 2, y - sigH / 2 - 8, {
          font: italic, size: 7, color: MUTED, align: "center",
        });
      } else {
        page.drawRectangle({
          x: leftX, y: y - sigH, width: colW, height: sigH,
          borderColor: AMBER, borderWidth: 0.8, borderDashArray: [3, 3], color: rgb(1, 251 / 255, 235 / 255),
        });
        text("Not yet signed — digital signature pending", leftX + colW / 2, y - sigH / 2 - 3, {
          font: italic, size: 8, color: AMBER, align: "center",
        });
      }
      y -= sigH + 6;
      page.drawLine({ start: { x: leftX, y }, end: { x: leftX + colW, y }, thickness: 0.8, color: INK });
      page.drawLine({ start: { x: rightX, y }, end: { x: rightX + colW, y }, thickness: 0.8, color: INK });
      y -= 11;
      text(
        isDraft ? m.name : `${m.name}  ·  ${fmtDate(signedAt)}`,
        leftX, y, { size: 8, color: MUTED },
      );
      text("Name & date: ____________________________", rightX, y, { size: 8, color: MUTED });
      y -= 14;

      if (!isDraft) {
        const audit = [
          `Signed digitally on ${fmtDateTime(signedAt)}`,
          input.signature?.ip ? `IP ${input.signature.ip}` : null,
          ref,
        ].filter(Boolean).join("  ·  ");
        text(audit, leftX, y, { size: 7, color: MUTED });
        y -= 10;
      }
    }
  }

  // -- Footer on every page + draft watermark --------------------------------
  const pages = pdf.getPages();
  const total = pages.length;
  const generatedLabel = `Generated ${fmtDateTime(generatedAt.toISOString())}`;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: FOOTER_H + 2 }, end: { x: PAGE_W - M, y: FOOTER_H + 2 }, thickness: 0.5, color: LINE });
    const left = winAnsi(`${generatedLabel}  ·  ${legalName}  ·  ${website}  ·  ${supportEmail}`);
    p.drawText(left, { x: M, y: FOOTER_H - 9, size: 7.2, font, color: MUTED });
    const right = `${ref}  ·  Page ${i + 1} of ${total}`;
    p.drawText(right, { x: PAGE_W - M - font.widthOfTextAtSize(right, 7.2), y: FOOTER_H - 9, size: 7.2, font, color: MUTED });
    if (isDraft) drawDraftWatermark(p);
  });

  return await pdf.save();
}
