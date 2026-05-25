// Real PDF blob generation using jsPDF + autoTable.
// All builders accept an optional `brand: BrandContext` for company/branch info.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DEFAULT_BRAND, type BrandContext } from '@/lib/brand/useBrandContext';
import { supabase } from '@/integrations/supabase/client';

const BRAND = {
  primary: [99, 102, 241] as [number, number, number], // indigo
  text: [30, 41, 59] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  success: [34, 197, 94] as [number, number, number],
  danger: [239, 68, 68] as [number, number, number],
};

function setColor(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function inr(n: number) {
  return `Rs. ${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function fallbackBrand(branchName?: string): BrandContext {
  return { ...DEFAULT_BRAND, branch: { name: branchName || 'Incline' } };
}

// ---------- LOGO LOADER (cached per-URL) ----------
const _logoCache = new Map<string, { dataUrl: string; w: number; h: number } | null>();
async function loadLogoDataUrl(url?: string | null): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;
  if (_logoCache.has(url)) return _logoCache.get(url)!;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims: { w: number; h: number } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = dataUrl;
    });
    const out = { dataUrl, w: dims.w, h: dims.h };
    _logoCache.set(url, out);
    return out;
  } catch {
    _logoCache.set(url, null);
    return null;
  }
}

// Resolve a BrandContext (with logoUrl) without React. Mirrors useBrandContext.
async function resolveBrandAsync(branchId?: string | null, branchName?: string | null): Promise<BrandContext> {
  let branch: BrandContext['branch'] = { name: branchName || 'Incline' };
  if (branchId) {
    const { data } = await supabase.from('branches').select('id,name,code,address,phone,email,gstin').eq('id', branchId).maybeSingle();
    if (data) branch = { id: data.id, name: data.name, code: (data as any).code ?? null, address: data.address ?? null, phone: data.phone ?? null, email: data.email ?? null, gstin: (data as any).gstin ?? null };
  }
  let logoUrl: string | null = null;
  const { data: globalRow } = await supabase.from('organization_settings').select('logo_url').is('branch_id', null).limit(1).maybeSingle();
  if (globalRow?.logo_url) logoUrl = globalRow.logo_url;
  if (branchId) {
    const { data: branchRow } = await supabase.from('organization_settings').select('logo_url').eq('branch_id', branchId).limit(1).maybeSingle();
    if (branchRow?.logo_url) logoUrl = branchRow.logo_url;
  }
  return { ...DEFAULT_BRAND, logoUrl, branch };
}

function header(
  doc: jsPDF,
  title: string,
  brandOrBranchName?: BrandContext | string,
  meta?: { docNumber?: string; issueDate?: string },
) {
  const brand: BrandContext =
    typeof brandOrBranchName === 'string' || brandOrBranchName == null
      ? fallbackBrand(brandOrBranchName as string | undefined)
      : brandOrBranchName;

  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, 210, 8, 'F');
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BRAND.primary);
  doc.text(brand.companyName.toUpperCase(), 14, 22);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setColor(doc, BRAND.muted);
  let yy = 28;
  if (brand.branch.name) { doc.text(brand.branch.name, 14, yy); yy += 4; }
  if (brand.branch.address) {
    const lines = doc.splitTextToSize(brand.branch.address, 100);
    doc.text(lines, 14, yy); yy += lines.length * 4;
  }
  const contact = [brand.branch.phone, brand.branch.email].filter(Boolean).join('  •  ');
  if (contact) { doc.text(contact, 14, yy); yy += 4; }
  if (brand.branch.gstin) { doc.text(`GSTIN: ${brand.branch.gstin}`, 14, yy); yy += 4; }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BRAND.text);
  doc.text(title, 196, 22, { align: 'right' });

  if (meta) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(doc, BRAND.muted);
    let my = 28;
    if (meta.docNumber) { doc.text(`# ${meta.docNumber}`, 196, my, { align: 'right' }); my += 4; }
    if (meta.issueDate) { doc.text(`Date: ${meta.issueDate}`, 196, my, { align: 'right' }); my += 4; }
  }
}

function footer(doc: jsPDF, brand?: BrandContext) {
  const b = brand || DEFAULT_BRAND;
  const pageH = doc.internal.pageSize.height;
  setColor(doc, BRAND.muted);
  doc.setFontSize(8);
  const line1 = `Generated ${new Date().toLocaleString('en-IN')} • ${b.legalName}`;
  doc.text(line1, 105, pageH - 12, { align: 'center' });
  const line2 = [b.website, b.supportEmail].filter(Boolean).join('  •  ');
  if (line2) doc.text(line2, 105, pageH - 7, { align: 'center' });
}

// Trigger a browser download for a blob.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Open a blob in a new tab for printing.
export function printBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) {
    w.addEventListener('load', () => w.print(), { once: true });
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Number to words (Indian, simple) for payslip.
export function rupeesInWords(num: number): string {
  num = Math.round(num);
  if (num === 0) return 'Zero Rupees Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + inWords(n % 10000000) : '');
  };
  return inWords(num).trim() + ' Rupees Only';
}

// ---------- INVOICE ----------
export interface InvoicePdfInput {
  invoice_number: string;
  created_at: string;
  due_date?: string | null;
  status: string;
  subtotal: number;
  discount_amount?: number | null;
  tax_amount?: number | null;
  gst_rate?: number | null;
  total_amount: number;
  amount_paid?: number | null;
  notes?: string | null;
  is_gst_invoice?: boolean | null;
  customer_gstin?: string | null;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
    hsn_code?: string;
    batches?: Array<{ batch_number: string; exp_date?: string | null; quantity?: number }>;
  }>;
  member_name: string;
  member_code?: string | null;
  member_email?: string | null;
  member_phone?: string | null;
  branch_name: string;
  branch_address?: string | null;
  branch_phone?: string | null;
  branch_email?: string | null;
  gst_number?: string | null;
}

export function buildInvoicePdf(data: InvoicePdfInput, brand?: BrandContext): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const title = data.is_gst_invoice ? 'TAX INVOICE' : 'INVOICE';
  const resolvedBrand: BrandContext = brand || {
    ...DEFAULT_BRAND,
    branch: {
      name: data.branch_name,
      address: data.branch_address ?? null,
      phone: data.branch_phone ?? null,
      email: data.branch_email ?? null,
      gstin: data.gst_number ?? null,
    },
  };
  header(doc, title, resolvedBrand, {
    docNumber: data.invoice_number,
    issueDate: new Date(data.created_at).toLocaleDateString('en-IN'),
  });

  let y = 56;
  setColor(doc, BRAND.muted);
  doc.setFontSize(9);
  if (data.due_date) doc.text(`Due: ${new Date(data.due_date).toLocaleDateString('en-IN')}`, 196, y, { align: 'right' });
  doc.text(`Status: ${(data.status || '').toUpperCase()}`, 196, y + 5, { align: 'right' });

  // Bill to
  y = 70;
  doc.setFillColor(248, 250, 252);
  doc.rect(14, y, 90, 26, 'F');
  setColor(doc, BRAND.muted);
  doc.setFontSize(8);
  doc.text('BILL TO', 17, y + 5);
  setColor(doc, BRAND.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(data.member_name, 17, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setColor(doc, BRAND.muted);
  if (data.member_code) doc.text(data.member_code, 17, y + 16);
  if (data.member_email) doc.text(data.member_email, 17, y + 20);
  if (data.member_phone) doc.text(data.member_phone, 17, y + 24);
  if (data.customer_gstin) doc.text(`GSTIN: ${data.customer_gstin}`, 60, y + 24);

  // Items table
  const showHsn = !!data.is_gst_invoice && data.items.some(i => i.hsn_code);
  const head = showHsn
    ? [['Description', 'HSN', 'Qty', 'Rate', 'Amount']]
    : [['Description', 'Qty', 'Rate', 'Amount']];
  const formatBatchSuffix = (batches?: Array<{ batch_number: string; exp_date?: string | null; quantity?: number }>): string => {
    if (!batches || batches.length === 0) return '';
    return '\n' + batches.map(b => {
      const exp = b.exp_date ? ` · EXP ${new Date(b.exp_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}` : '';
      const q = (b.quantity && batches.length > 1) ? ` (×${b.quantity})` : '';
      return `Batch: ${b.batch_number}${exp}${q}`;
    }).join('\n');
  };
  const body = data.items.map(i => {
    const desc = `${i.description}${formatBatchSuffix(i.batches)}`;
    return showHsn
      ? [desc, i.hsn_code || '-', String(i.quantity || 1), inr(i.unit_price), inr(i.total_amount)]
      : [desc, String(i.quantity || 1), inr(i.unit_price), inr(i.total_amount)];
  });

  autoTable(doc, {
    startY: y + 32,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, textColor: BRAND.text },
    columnStyles: showHsn
      ? { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
      : { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  // Totals
  const tableEnd = (doc as any).lastAutoTable.finalY + 6;
  const right = 196;
  const labelX = 140;
  doc.setFontSize(9);
  setColor(doc, BRAND.muted);
  let ty = tableEnd;
  const row = (label: string, value: string, color?: [number, number, number]) => {
    setColor(doc, BRAND.muted);
    doc.text(label, labelX, ty);
    if (color) setColor(doc, color); else setColor(doc, BRAND.text);
    doc.text(value, right, ty, { align: 'right' });
    ty += 5;
  };
  row('Subtotal', inr(data.subtotal));
  if ((data.discount_amount || 0) > 0) row('Discount', `-${inr(data.discount_amount!)}`, BRAND.success);
  if ((data.tax_amount || 0) > 0) {
    const half = (data.tax_amount || 0) / 2;
    const rate = data.gst_rate ? ` @ ${data.gst_rate / 2}%` : '';
    row(`CGST${rate}`, inr(half));
    row(`SGST${rate}`, inr(half));
  }
  doc.setLineWidth(0.4);
  doc.setDrawColor(...BRAND.text);
  doc.line(labelX, ty, right, ty);
  ty += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setColor(doc, BRAND.text);
  doc.text('Total', labelX, ty);
  doc.text(inr(data.total_amount), right, ty, { align: 'right' });
  ty += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if ((data.amount_paid || 0) > 0) row('Paid', inr(data.amount_paid!), BRAND.success);
  const due = data.total_amount - (data.amount_paid || 0);
  if (due > 0) {
    doc.setFont('helvetica', 'bold');
    row('Balance Due', inr(due), BRAND.danger);
    doc.setFont('helvetica', 'normal');
  }

  if (data.notes) {
    ty += 6;
    setColor(doc, BRAND.muted);
    doc.setFontSize(8);
    doc.text('Notes:', 14, ty);
    setColor(doc, BRAND.text);
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(data.notes, 180);
    doc.text(lines, 14, ty + 4);
  }

  footer(doc, resolvedBrand);
  return doc.output('blob');
}

// ---------- PAYMENT RECEIPT ----------
export interface PaymentReceiptInput {
  receipt_number: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  transaction_id?: string | null;
  invoice_number?: string | null;
  member_name: string;
  member_code?: string | null;
  branch_name: string;
  branch_address?: string | null;
  notes?: string | null;
  invoice_total?: number | null;
  invoice_paid?: number | null;
}

export function buildPaymentReceiptPdf(data: PaymentReceiptInput, brand?: BrandContext): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const resolvedBrand: BrandContext = brand || {
    ...DEFAULT_BRAND,
    branch: { name: data.branch_name, address: data.branch_address ?? null },
  };
  header(doc, 'PAYMENT RECEIPT', resolvedBrand, {
    docNumber: data.receipt_number,
    issueDate: new Date(data.payment_date).toLocaleString('en-IN'),
  });

  let y = 56;
  setColor(doc, BRAND.muted);

  y += 12;
  doc.setFillColor(240, 253, 244);
  doc.rect(14, y, 182, 24, 'F');
  setColor(doc, BRAND.success);
  doc.setFontSize(10);
  doc.text('AMOUNT RECEIVED', 105, y + 8, { align: 'center' });
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(inr(data.amount), 105, y + 19, { align: 'center' });
  doc.setFont('helvetica', 'normal');

  y += 32;
  setColor(doc, BRAND.text);
  doc.setFontSize(10);
  const rows: Array<[string, string]> = [
    ['Received From', data.member_name + (data.member_code ? ` (${data.member_code})` : '')],
    ['Payment Method', data.payment_method.toUpperCase()],
  ];
  if (data.invoice_number) rows.push(['Invoice', data.invoice_number]);
  if (data.transaction_id) rows.push(['Transaction ID', data.transaction_id]);
  if (typeof data.invoice_total === 'number') {
    rows.push(['Invoice Total', inr(data.invoice_total)]);
    rows.push(['Total Paid', inr(data.invoice_paid || 0)]);
    const bal = (data.invoice_total || 0) - (data.invoice_paid || 0);
    if (bal > 0) rows.push(['Balance Due', inr(bal)]);
  }
  if (data.notes) rows.push(['Notes', data.notes]);

  autoTable(doc, {
    startY: y,
    body: rows,
    theme: 'plain',
    bodyStyles: { fontSize: 10, textColor: BRAND.text },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: BRAND.muted } },
    margin: { left: 14, right: 14 },
  });

  footer(doc, resolvedBrand);
  return doc.output('blob');
}

// Curated content pools — picked deterministically per plan name so the same
// plan always renders the same quote/tips (stable across re-downloads).
const WORKOUT_QUOTES = [
  'Discipline outlasts motivation. Show up — even on the days you don\'t feel like it.',
  'Strength is built rep by rep. Trust the process, respect the recovery.',
  'You don\'t rise to the level of your goals. You fall to the level of your training.',
  'Sweat is just fat crying. Earn the pump.',
  'Train hard. Eat well. Sleep deep. Repeat.',
  'The barbell doesn\'t care about your bad day. Neither should you.',
];
const DIET_QUOTES = [
  'Abs are built in the kitchen. The gym just sharpens them.',
  'Eat for the body you want, not the body you have today.',
  'Consistency beats perfection. One clean meal at a time.',
  'Real food. Real progress. No shortcuts.',
  'Nutrition fuels training; training rewards nutrition.',
  'Hydrate, sleep, repeat — the cheat code is unsexy.',
];
const WORKOUT_DOS = [
  '5–10 min dynamic warm-up before every session',
  'Hydrate — sip water between every set',
  'Log every set: weight, reps, RIR',
  'Sleep 7–8 hrs for recovery & growth',
  'Progressive overload weekly (weight or reps)',
  'Ask your trainer if form feels off',
];
const WORKOUT_DONTS = [
  'Skip the warm-up to "save time"',
  'Ego-lift — form first, weight second',
  'Train through sharp / joint pain',
  'Hold your breath under heavy loads',
  'Compare your day-1 to someone\'s year-3',
  'Skip rest days — recovery is when you grow',
];
const DIET_DOS = [
  'Eat protein at every meal (palm-sized portion)',
  'Hydrate: 35–40 ml water per kg bodyweight',
  'Prep meals 1–2 days ahead — beats hunger decisions',
  'Eat slowly — chew, savour, stop at 80% full',
  'Vegetables on half the plate at lunch & dinner',
  'Sleep 7–8 hrs — poor sleep wrecks appetite hormones',
];
const DIET_DONTS = [
  'Skip meals to "save calories"',
  'Drink your calories (sugary drinks, juices)',
  'Crash diet or cut carbs to zero',
  'Eat large meals late at night',
  'Rely on supplements over real food',
  'Weigh yourself daily — track weekly trend instead',
];
const WORKOUT_TIPS = [
  'Form > weight. Always.',
  'Track sessions in an app or notebook.',
  'Deload every 4–6 weeks to recover.',
];
const DIET_TIPS = [
  'Prep proteins on Sunday for the week.',
  'Keep healthy snacks visible & junk hidden.',
  'Plan one weekly treat — sustainability wins.',
];

function pickByHash<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}

// ---------- DIET / WORKOUT PLAN ----------
export interface PlanPdfInput {
  name: string;
  type: 'workout' | 'diet';
  description?: string | null;
  caloriesTarget?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  data: any;
  member_name?: string | null;
  member_code?: string | null;
  trainer_name?: string | null;
  goal?: string | null;
  notes?: string | null;
  branch_name?: string | null;
  branch_id?: string | null;
}

// Async — fetches DB logo if `brand.logoUrl` not provided.
export async function buildPlanPdf(input: PlanPdfInput, brand?: BrandContext): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const isWorkout = input.type === 'workout';
  const title = isWorkout ? 'YOUR WORKOUT PLAN' : 'YOUR PERSONALIZED DIET PLAN';
  const resolvedBrand: BrandContext =
    brand ?? (await resolveBrandAsync(input.branch_id, input.branch_name));
  const logo = await loadLogoDataUrl(resolvedBrand.logoUrl);
  const accent: [number, number, number] = isWorkout ? [99, 102, 241] : [16, 185, 129]; // indigo or emerald

  // ---- HERO BAND (dark) ----
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 56, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, 56, 210, 2, 'F');

  // Logo (white card top-left), or wordmark fallback
  if (logo) {
    const maxH = 16, maxW = 36;
    const ratio = logo.w / Math.max(1, logo.h);
    let lh = maxH, lw = lh * ratio;
    if (lw > maxW) { lw = maxW; lh = lw / ratio; }
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(10, 10, lw + 6, lh + 6, 1.5, 1.5, 'F');
    try { doc.addImage(logo.dataUrl, 'PNG', 13, 13, lw, lh, undefined, 'FAST'); } catch { /* ignore */ }
  } else {
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('INCLINE', 14, 18);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Rise. Reflect. Repeat.', 14, 23);
  }

  // Title block (right-aligned)
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(title, 200, 22, { align: 'right' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240);
  doc.text(input.name, 200, 30, { align: 'right' });

  // Member / trainer / goal line
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const heroLine: string[] = [];
  if (input.member_name) heroLine.push(`For ${input.member_name}${input.member_code ? ` (${input.member_code})` : ''}`);
  if (input.trainer_name) heroLine.push(`Trainer: ${input.trainer_name}`);
  if (input.goal) heroLine.push(`Goal: ${input.goal}`);
  if (heroLine.length) doc.text(heroLine.join('  •  '), 200, 38, { align: 'right' });

  // Tagline strip under hero
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('RISE. REFLECT. REPEAT.', 200, 48, { align: 'right' });

  // ---- MOTIVATIONAL QUOTE STRIP ----
  const quote = pickByHash(isWorkout ? WORKOUT_QUOTES : DIET_QUOTES, input.name);
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 60, 210, 22, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  setColor(doc, accent);
  doc.text(`"${quote}"`, 105, 70, { align: 'center', maxWidth: 180 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(doc, BRAND.muted);
  doc.text('— Team Incline', 196, 78, { align: 'right' });

  let y = 90;

  // ---- BODY ----
  if (isWorkout) {
    const weeks = input.data?.weeks || (input.data?.days ? [{ week: 1, days: input.data.days }] : []);
    weeks.forEach((week: any, wi: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      setColor(doc, accent);
      doc.text(`WEEK ${week.week || wi + 1}`, 14, y);
      doc.setDrawColor(...accent);
      doc.setLineWidth(0.6);
      doc.line(14, y + 1.5, 40, y + 1.5);
      y += 6;
      (week.days || []).forEach((day: any, di: number) => {
        const dayLabel = day.day || day.label || `Day ${di + 1}`;
        const focusSuffix = day.focus ? ` — ${day.focus}` : '';
        const rows: any[] = (day.exercises || []).map((ex: any) => {
          if (typeof ex === 'string') return [{ content: '', _exercise: ex, _machine: '', styles: { minCellHeight: 9 } }, '', '', '', '', ''];
          const machine = ex.equipment ? String(ex.equipment) : '';
          const exerciseName = ex.name || ex.exercise || '';
          const exerciseCell = {
            content: '',
            _exercise: exerciseName,
            _machine: machine,
            styles: { minCellHeight: machine ? 12 : 9 },
          };
          const sets = ex.sets ? String(ex.sets) : '';
          const reps = ex.reps ? String(ex.reps) : '';
          const rest = ex.rest || (ex.rest_seconds ? `${ex.rest_seconds}s` : '');
          const tipsRaw = Array.isArray(ex.form_tips) ? ex.form_tips.join(' • ') : (ex.form_tips || '');
          const tips = tipsRaw ? String(tipsRaw).slice(0, 80) : '';
          return [exerciseCell, sets, reps, rest, ex.weight || '', tips];
        });
        autoTable(doc, {
          startY: y,
          head: [[`${dayLabel}${focusSuffix}`, 'Sets', 'Reps', 'Rest', 'Load', 'Form Tips']],
          body: rows.length ? rows : [['Rest day', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', fontSize: 9 },
          bodyStyles: { fontSize: 8.5, textColor: BRAND.text, valign: 'middle' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: 60 },
            1: { halign: 'center', cellWidth: 14 },
            2: { halign: 'center', cellWidth: 18 },
            3: { halign: 'center', cellWidth: 16 },
            4: { halign: 'center', cellWidth: 18 },
            5: { cellWidth: 'auto', textColor: BRAND.muted, fontSize: 8 },
          },
          margin: { left: 14, right: 14 },
          didDrawCell: (data) => {
            // Custom-render exercise column: bold exercise name + muted machine sublabel
            if (data.section === 'body' && data.column.index === 0) {
              const raw = data.cell.raw as any;
              if (raw && typeof raw === 'object' && '_exercise' in raw) {
                const x = data.cell.x + 2;
                const w = data.cell.width - 4;
                let yy = data.cell.y + 4.5;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                setColor(doc, BRAND.text);
                doc.text(String(raw._exercise || '—'), x, yy, { maxWidth: w });
                if (raw._machine) {
                  yy += 4;
                  doc.setFont('helvetica', 'normal');
                  doc.setFontSize(7.5);
                  setColor(doc, BRAND.muted);
                  doc.text(String(raw._machine), x, yy, { maxWidth: w });
                }
              }
            }
          },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
        if (y > 260) { doc.addPage(); y = 20; }
      });
      y += 2;
    });
  } else {
    // Diet body
    const meals = input.data?.meals || input.data?.days?.[0]?.meals || [];
    if (meals.length) {
      const itemsToString = (m: any) => {
        if (!m.items) return m.description || '';
        if (!Array.isArray(m.items)) return String(m.items);
        return m.items.map((it: any) => typeof it === 'string' ? it : (it.food || it.name || '')).filter(Boolean).join(', ');
      };
      let totC = 0, totP = 0, totCa = 0, totF = 0, totFi = 0, totS = 0, totSu = 0;
      const rows = meals.map((m: any) => {
        const cal = Number(m.calories) || 0;
        const p = Number(m.protein) || 0;
        const c = Number(m.carbs) || 0;
        const f = Number(m.fats ?? m.fat) || 0;
        const fi = Number(m.fiber) || 0;
        const so = Number(m.sodium) || 0;
        const su = Number(m.sugar) || 0;
        totC += cal; totP += p; totCa += c; totF += f; totFi += fi; totS += so; totSu += su;
        return [
          { content: m.meal || m.name || '-', styles: { fontStyle: 'bold' as const } },
          m.time || '—',
          itemsToString(m) || '—',
          cal ? `${cal}` : '—',
          p ? `${p}g` : '—',
          c ? `${c}g` : '—',
          f ? `${f}g` : '—',
        ];
      });
      // Totals row
      rows.push([
        { content: 'DAY TOTAL', styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as any, textColor: [15, 23, 42] as any } },
        { content: '', styles: { fillColor: [241, 245, 249] as any } },
        { content: '', styles: { fillColor: [241, 245, 249] as any } },
        { content: `${totC} kcal`, styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as any } },
        { content: `${totP}g`, styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as any } },
        { content: `${totCa}g`, styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as any } },
        { content: `${totF}g`, styles: { fontStyle: 'bold' as const, fillColor: [241, 245, 249] as any } },
      ]);
      autoTable(doc, {
        startY: y,
        head: [['Meal', 'Time', 'Items', 'Calories', 'Protein', 'Carbs', 'Fats']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: accent as any, textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 8.5, textColor: BRAND.text, valign: 'middle' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 32 },
          1: { cellWidth: 24, halign: 'center' },
          2: { cellWidth: 'auto', fontSize: 8, textColor: BRAND.muted },
          3: { cellWidth: 18, halign: 'right' },
          4: { cellWidth: 16, halign: 'right' },
          5: { cellWidth: 14, halign: 'right' },
          6: { cellWidth: 14, halign: 'right' },
        },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;

      // Micros strip
      if (totFi || totS || totSu) {
        doc.setFillColor(238, 242, 255);
        doc.rect(14, y, 182, 12, 'F');
        setColor(doc, BRAND.primary);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('MICRONUTRIENTS (DAILY)', 18, y + 5);
        setColor(doc, BRAND.text);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const micros = [
          totFi ? `Fiber ${totFi}g` : null,
          totSu ? `Sugar ${totSu}g` : null,
          totS ? `Sodium ${totS}mg` : null,
        ].filter(Boolean).join('   •   ');
        doc.text(micros, 18, y + 10);
        y += 16;
      }

      // Hydration / supplements
      const extras: string[] = [];
      if (input.data?.hydration) extras.push(`Hydration: ${input.data.hydration}`);
      if (Array.isArray(input.data?.supplements) && input.data.supplements.length) {
        extras.push(`Supplements: ${input.data.supplements.join(', ')}`);
      }
      if (extras.length) {
        setColor(doc, BRAND.muted);
        doc.setFontSize(9);
        extras.forEach((line) => {
          const wrapped = doc.splitTextToSize(line, 180);
          doc.text(wrapped, 14, y);
          y += wrapped.length * 4 + 2;
        });
      }
    } else {
      doc.text('No meals defined.', 14, y);
      y += 6;
    }
  }

  if (input.notes) {
    y += 4;
    setColor(doc, BRAND.muted);
    doc.setFontSize(8);
    doc.text('NOTES', 14, y);
    setColor(doc, BRAND.text);
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(input.notes, 180);
    doc.text(lines, 14, y + 4);
    y += 4 + lines.length * 4;
  }

  // ---- DO'S & DON'TS + TIPS (fresh page) ----
  doc.addPage();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 16, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, 16, 210, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text("TRAINING WISDOM — DO'S, DON'TS & PRO TIPS", 14, 11);

  const dos = isWorkout ? WORKOUT_DOS : DIET_DOS;
  const donts = isWorkout ? WORKOUT_DONTS : DIET_DONTS;
  const tips = isWorkout ? WORKOUT_TIPS : DIET_TIPS;

  let py = 28;
  doc.setFillColor(236, 253, 245);
  doc.rect(14, py, 88, 95, 'F');
  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.4);
  doc.line(14, py, 14, py + 95);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(5, 122, 85);
  doc.text('DO', 19, py + 8);
  dos.forEach((item, i) => {
    doc.setFillColor(16, 185, 129);
    doc.circle(20.5, py + 16 + i * 12, 1.4, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(item, 76);
    doc.text(lines, 25, py + 18 + i * 12);
  });

  doc.setFillColor(254, 242, 242);
  doc.rect(108, py, 88, 95, 'F');
  doc.setDrawColor(239, 68, 68);
  doc.line(108, py, 108, py + 95);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(185, 28, 28);
  doc.text("DON'T", 113, py + 8);
  donts.forEach((item, i) => {
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(0.6);
    const cx = 114, cy = py + 16 + i * 12, r = 1.6;
    doc.line(cx - r, cy - r, cx + r, cy + r);
    doc.line(cx - r, cy + r, cx + r, cy - r);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(item, 76);
    doc.text(lines, 119, py + 18 + i * 12);
  });

  py += 105;
  doc.setFillColor(15, 23, 42);
  doc.rect(14, py, 182, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PRO TIPS', 19, py + 5.5);

  py += 12;
  const tipW = 60;
  tips.forEach((tip, i) => {
    const x = 14 + i * (tipW + 2);
    doc.setFillColor(248, 250, 252);
    doc.rect(x, py, tipW, 28, 'F');
    setColor(doc, accent);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`${i + 1}`, x + 4, py + 9);
    setColor(doc, BRAND.text);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(tip, tipW - 14);
    doc.text(lines, x + 12, py + 8);
  });

  // Final brand sign-off band (no dates, no validity)
  py += 38;
  doc.setFillColor(15, 23, 42);
  doc.rect(0, py, 210, 26, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, py, 210, 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('INCLINE', 105, py + 10, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(203, 213, 225);
  doc.text('Rise. Reflect. Repeat.', 105, py + 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  const tagLine = [resolvedBrand.branch?.name, resolvedBrand.branch?.phone, resolvedBrand.branch?.email]
    .filter(Boolean).join('  •  ');
  if (tagLine) doc.text(tagLine, 105, py + 20, { align: 'center' });
  doc.setFontSize(7);
  doc.text('THE INCLINE LIFE BY INCLINE', 105, py + 24, { align: 'center' });

  // Page footers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    setColor(doc, BRAND.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Page ${i} of ${pageCount}`, 196, doc.internal.pageSize.height - 4, { align: 'right' });
  }

  return doc.output('blob');
}


// ---------- PAYSLIP ----------
export interface PayslipPdfInput {
  employee_name: string;
  employee_code?: string | null;
  designation?: string | null;
  period_label: string;        // e.g. "Sep 2026"
  period_start: string;
  period_end: string;
  attendance: {
    present?: number; half_day?: number; late?: number; missing_checkout?: number;
    leave?: number; holiday?: number; weekly_off?: number; absent?: number;
    payable_days?: number; total_days?: number; monthly_salary?: number;
  };
  earnings: { base: number; pt_commission: number; ot: number; bonus: number };
  deductions: { deductions: number; advance: number; penalty: number };
  gross: number;
  net: number;
  payment_method?: string | null;
  payment_reference?: string | null;
  paid_date?: string | null;
  prepared_by?: string | null;
  notes?: string | null;
}

export function buildPayslipPdf(data: PayslipPdfInput, brand: BrandContext): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  header(doc, 'PAYSLIP', brand, {
    docNumber: data.period_label,
    issueDate: new Date().toLocaleDateString('en-IN'),
  });

  let y = 58;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BRAND.text);
  doc.text(data.employee_name, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setColor(doc, BRAND.muted);
  const sub = [data.employee_code, data.designation].filter(Boolean).join(' • ');
  if (sub) { doc.text(sub, 14, y + 5); }
  doc.text(
    `Period: ${new Date(data.period_start).toLocaleDateString('en-IN')} – ${new Date(data.period_end).toLocaleDateString('en-IN')}`,
    196, y, { align: 'right' },
  );

  // Attendance summary
  y += 14;
  const a = data.attendance || {};
  autoTable(doc, {
    startY: y,
    head: [['Present', 'Half', 'Late', 'Missing', 'Leave', 'Holiday', 'Off', 'Absent', 'Payable']],
    body: [[
      String(a.present ?? 0), String(a.half_day ?? 0), String(a.late ?? 0),
      String(a.missing_checkout ?? 0), String(a.leave ?? 0), String(a.holiday ?? 0),
      String(a.weekly_off ?? 0), String(a.absent ?? 0), String(a.payable_days ?? 0),
    ]],
    theme: 'grid',
    headStyles: { fillColor: BRAND.primary, textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 9, halign: 'center' },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // Earnings + deductions side-by-side
  const earningsRows: Array<[string, string]> = [
    ['Basic / Pro-rated', inr(data.earnings.base)],
    ['PT Commission', inr(data.earnings.pt_commission)],
    ['Overtime', inr(data.earnings.ot)],
    ['Bonus', inr(data.earnings.bonus)],
    ['Gross Earnings', inr(data.gross)],
  ];
  const deductionRows: Array<[string, string]> = [
    ['Deductions', inr(data.deductions.deductions)],
    ['Advance', inr(data.deductions.advance)],
    ['Penalty', inr(data.deductions.penalty)],
    ['Total Deductions', inr(data.deductions.deductions + data.deductions.advance + data.deductions.penalty)],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Earnings', '']],
    body: earningsRows,
    theme: 'grid',
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    margin: { left: 14, right: 110 },
    tableWidth: 88,
  });
  autoTable(doc, {
    startY: y,
    head: [['Deductions', '']],
    body: deductionRows,
    theme: 'grid',
    headStyles: { fillColor: BRAND.danger, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    margin: { left: 108, right: 14 },
    tableWidth: 88,
  });

  const ny = Math.max(
    (doc as any).lastAutoTable.finalY,
    (doc as any).previousAutoTable?.finalY || 0,
  ) + 8;

  // Net pay
  doc.setFillColor(238, 242, 255);
  doc.rect(14, ny, 182, 18, 'F');
  setColor(doc, BRAND.primary);
  doc.setFontSize(10);
  doc.text('NET PAY', 18, ny + 7);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  setColor(doc, BRAND.text);
  doc.text(inr(data.net), 192, ny + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setColor(doc, BRAND.muted);
  doc.text(rupeesInWords(data.net), 18, ny + 14);

  let py = ny + 24;
  doc.setFontSize(9);
  setColor(doc, BRAND.muted);
  if (data.payment_method) { doc.text(`Payment: ${data.payment_method.toUpperCase()}${data.payment_reference ? ` (${data.payment_reference})` : ''}`, 14, py); py += 4; }
  if (data.paid_date) { doc.text(`Paid on: ${new Date(data.paid_date).toLocaleDateString('en-IN')}`, 14, py); py += 4; }
  if (data.prepared_by) { doc.text(`Prepared by: ${data.prepared_by}`, 14, py); py += 4; }
  if (data.notes) {
    py += 2;
    doc.text('Notes: ' + data.notes, 14, py);
  }

  footer(doc, brand);
  return doc.output('blob');
}

// ---------- CONTRACT ----------
export interface ContractPdfInput {
  contract_number?: string | null;
  employee_name: string;
  employee_code?: string | null;
  position?: string | null;
  department?: string | null;
  contract_type: string;
  start_date: string;
  end_date?: string | null;
  salary: number;
  salary_type?: string | null;
  terms?: string | null;
  prepared_by?: string | null;
}

export function buildContractPdf(data: ContractPdfInput, brand: BrandContext): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  header(doc, 'EMPLOYMENT CONTRACT', brand, {
    docNumber: data.contract_number || undefined,
    issueDate: new Date().toLocaleDateString('en-IN'),
  });

  let y = 58;
  doc.setFontSize(10);
  setColor(doc, BRAND.text);
  doc.setFont('helvetica', 'bold');
  doc.text('Between', 14, y); y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`${brand.legalName} ("Company")`, 14, y); y += 5;
  if (brand.branch.address) {
    const lines = doc.splitTextToSize(brand.branch.address, 180);
    doc.text(lines, 14, y); y += lines.length * 4;
  }
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('And', 14, y); y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.employee_name}${data.employee_code ? ` (${data.employee_code})` : ''} ("Employee")`, 14, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    body: [
      ['Position', data.position || '-'],
      ['Department', data.department || '-'],
      ['Contract Type', data.contract_type],
      ['Start Date', new Date(data.start_date).toLocaleDateString('en-IN')],
      ['End Date', data.end_date ? new Date(data.end_date).toLocaleDateString('en-IN') : 'Open-ended'],
      ['Salary', `${inr(data.salary)}${data.salary_type ? ` / ${data.salary_type}` : ''}`],
    ],
    theme: 'plain',
    bodyStyles: { fontSize: 10 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: BRAND.muted } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  if (data.terms) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(doc, BRAND.text);
    doc.text('Terms & Conditions', 14, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(data.terms, 180);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 6;
  }

  // Signature blocks
  const pageH = doc.internal.pageSize.height;
  const sy = Math.max(y, pageH - 50);
  doc.setLineWidth(0.3);
  doc.setDrawColor(...BRAND.muted);
  doc.line(20, sy, 90, sy);
  doc.line(120, sy, 190, sy);
  setColor(doc, BRAND.muted);
  doc.setFontSize(9);
  doc.text('Company Representative', 20, sy + 5);
  doc.text('Employee Signature', 120, sy + 5);

  footer(doc, brand);
  return doc.output('blob');
}

// ============================================================================
// THERMAL RECEIPT (80mm) — single source of truth for POS-style receipts.
// ============================================================================
export function buildThermalReceiptPdf(data: InvoicePdfInput, brand?: BrandContext): Blob {
  // 80mm wide, dynamic height (we'll add pages as needed). jsPDF needs a fixed
  // page format, so we use 80x297 portrait and rely on text flow.
  const doc = new jsPDF({ unit: 'mm', format: [80, 297] });
  const resolvedBrand: BrandContext = brand || {
    ...DEFAULT_BRAND,
    branch: {
      name: data.branch_name,
      phone: data.branch_phone ?? null,
      gstin: data.gst_number ?? null,
    },
  };
  const W = 80;
  const margin = 4;
  let y = 6;

  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  setColor(doc, BRAND.text);
  doc.text(resolvedBrand.companyName.toUpperCase(), W / 2, y, { align: 'center' });
  y += 4;
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  setColor(doc, BRAND.muted);
  if (resolvedBrand.branch.name) { doc.text(resolvedBrand.branch.name, W / 2, y, { align: 'center' }); y += 3; }
  if (resolvedBrand.branch.phone) { doc.text(`Tel: ${resolvedBrand.branch.phone}`, W / 2, y, { align: 'center' }); y += 3; }
  if (resolvedBrand.branch.gstin) { doc.text(`GSTIN: ${resolvedBrand.branch.gstin}`, W / 2, y, { align: 'center' }); y += 3; }

  const dash = () => {
    doc.setDrawColor(0); doc.setLineDashPattern([0.6, 0.6], 0);
    doc.line(margin, y, W - margin, y); doc.setLineDashPattern([], 0);
    y += 2.5;
  };
  dash();

  setColor(doc, BRAND.text);
  doc.setFontSize(8);
  doc.text(data.invoice_number, margin, y);
  doc.text(new Date(data.created_at).toLocaleDateString('en-IN'), W - margin, y, { align: 'right' });
  y += 3;
  doc.text(`Customer: ${data.member_name}`, margin, y);
  y += 3;
  dash();

  // Items header
  doc.setFont('courier', 'bold');
  doc.text('ITEM', margin, y);
  doc.text('QTY', W - margin - 14, y, { align: 'right' });
  doc.text('AMT', W - margin, y, { align: 'right' });
  y += 3;
  doc.setFont('courier', 'normal');

  data.items.forEach((it) => {
    const nameLines = doc.splitTextToSize(it.description, W - margin * 2 - 22);
    doc.text(nameLines, margin, y);
    doc.text(String(it.quantity || 1), W - margin - 14, y, { align: 'right' });
    doc.text(`Rs.${(it.total_amount || 0).toLocaleString('en-IN')}`, W - margin, y, { align: 'right' });
    y += nameLines.length * 3 + 0.5;
    if (it.batches && it.batches.length) {
      doc.setFontSize(7);
      setColor(doc, BRAND.muted);
      it.batches.forEach((b) => {
        const exp = b.exp_date ? ` EXP ${new Date(b.exp_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}` : '';
        doc.text(`  Batch ${b.batch_number}${exp}`, margin, y);
        y += 2.8;
      });
      doc.setFontSize(8);
      setColor(doc, BRAND.text);
    }
  });
  dash();

  const line = (label: string, val: string, bold = false) => {
    if (bold) doc.setFont('courier', 'bold');
    doc.text(label, margin, y);
    doc.text(val, W - margin, y, { align: 'right' });
    if (bold) doc.setFont('courier', 'normal');
    y += 3;
  };
  line('Subtotal', `Rs.${(data.subtotal || 0).toLocaleString('en-IN')}`);
  if ((data.discount_amount || 0) > 0) line('Discount', `-Rs.${(data.discount_amount || 0).toLocaleString('en-IN')}`);
  if ((data.tax_amount || 0) > 0) {
    const half = (data.tax_amount || 0) / 2;
    const r = data.gst_rate ? data.gst_rate / 2 : 0;
    line(`CGST${r ? ' @' + r + '%' : ''}`, `Rs.${half.toLocaleString('en-IN')}`);
    line(`SGST${r ? ' @' + r + '%' : ''}`, `Rs.${half.toLocaleString('en-IN')}`);
  }
  dash();
  doc.setFontSize(10);
  line('TOTAL', `Rs.${(data.total_amount || 0).toLocaleString('en-IN')}`, true);
  doc.setFontSize(8);
  if ((data.amount_paid || 0) > 0) line('Paid', `Rs.${(data.amount_paid || 0).toLocaleString('en-IN')}`);
  const due = (data.total_amount || 0) - (data.amount_paid || 0);
  if (due > 0) line('DUE', `Rs.${due.toLocaleString('en-IN')}`, true);
  dash();

  setColor(doc, BRAND.muted);
  doc.text('Thank you! Visit again.', W / 2, y, { align: 'center' }); y += 3;
  doc.text(new Date().toLocaleString('en-IN'), W / 2, y, { align: 'center' });
  y += 3;
  doc.setFontSize(7);
  doc.text(resolvedBrand.legalName, W / 2, y, { align: 'center' });

  return doc.output('blob');
}

// ============================================================================
// REGISTRATION FORM — single source of truth for member onboarding waiver PDFs.
// ============================================================================
export interface RegistrationFormPdfInput {
  data: {
    memberName: string;
    memberCode: string;
    email?: string;
    phone?: string;
    gender?: string;
    dateOfBirth?: string;
    address?: string;
    city?: string;
    state?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    planName?: string;
    startDate?: string;
    endDate?: string;
    pricePaid?: number;
    branchName?: string;
  };
  govIdType: string;
  govIdNumber: string;
  fitnessGoals: string;
  medicalConditions: string;
  parq?: Record<string, string>;
  parqQuestions: string[];
  customTerms: string;
  terms: Array<{ title: string; body: string }>;
  declaration: string;
  signatureDataUrl?: string | null;
}

function fmtDate(d?: string) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export function buildRegistrationFormPdf(args: RegistrationFormPdfInput, brand?: BrandContext): Blob {
  const { data, govIdType, govIdNumber, fitnessGoals, medicalConditions, parq, parqQuestions, customTerms, terms, declaration, signatureDataUrl } = args;
  const resolvedBrand: BrandContext = brand || {
    ...DEFAULT_BRAND,
    branch: { name: data.branchName || 'Incline' },
  };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 14;

  header(doc, 'MEMBERSHIP REGISTRATION', resolvedBrand, {
    docNumber: `REG-${data.memberCode}`,
    issueDate: fmtDate(new Date().toISOString()),
  });

  let y = 56;

  const section = (title: string) => {
    if (y > pageH - 40) { doc.addPage(); y = 20; }
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, pageW - margin * 2, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setColor(doc, BRAND.primary);
    doc.text(title.toUpperCase(), margin + 2, y + 4.2);
    y += 8;
  };

  const fieldsTable = (rows: Array<[string, string]>) => {
    autoTable(doc, {
      startY: y,
      body: rows.map(([k, v]) => [k, v || '—']),
      theme: 'plain',
      bodyStyles: { fontSize: 9, textColor: BRAND.text, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 } },
      columnStyles: { 0: { fontStyle: 'bold', textColor: BRAND.muted, cellWidth: 45 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  };

  section('Member Information');
  fieldsTable([
    ['Full Name', data.memberName],
    ['Member Code', data.memberCode],
    ['Email', data.email || ''],
    ['Phone', data.phone || ''],
    ['Gender', data.gender || ''],
    ['Date of Birth', fmtDate(data.dateOfBirth)],
    ['Address', [data.address, data.city, data.state].filter(Boolean).join(', ')],
  ]);

  section('Government ID');
  fieldsTable([
    ['ID Type', govIdType.toUpperCase()],
    ['ID Number', govIdNumber],
  ]);

  section('Emergency Contact');
  fieldsTable([
    ['Name', data.emergencyContactName || ''],
    ['Phone', data.emergencyContactPhone || ''],
  ]);

  section('Health & Fitness');
  fieldsTable([
    ['Fitness Goals', fitnessGoals],
    ['Medical Conditions', medicalConditions || 'None declared'],
  ]);

  if (parq && parqQuestions.length) {
    section('PAR-Q Health Screen');
    autoTable(doc, {
      startY: y,
      head: [['#', 'Question', 'Answer']],
      body: parqQuestions.map((q, i) => [String(i + 1), q, (parq[q] || 'no').toUpperCase()]),
      theme: 'striped',
      headStyles: { fillColor: BRAND.primary as any, fontSize: 8.5, textColor: 255 },
      bodyStyles: { fontSize: 8.5, textColor: BRAND.text },
      columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 18, halign: 'center', fontStyle: 'bold' } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  section('Membership Details');
  fieldsTable([
    ['Plan', data.planName || ''],
    ['Amount', data.pricePaid ? inr(data.pricePaid) : ''],
    ['Start Date', fmtDate(data.startDate)],
    ['End Date', fmtDate(data.endDate)],
    ['Branch', data.branchName || ''],
  ]);

  section('Terms & Conditions');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setColor(doc, BRAND.text);
  const allTerms = customTerms ? [...terms, { title: 'Custom Terms', body: customTerms }] : terms;
  const lineH = 3.4;
  allTerms.forEach((t, i) => {
    const titleStr = `${i + 1}. ${t.title}`;
    const bodyLines = doc.splitTextToSize(t.body, pageW - margin * 2 - 4);
    const blockH = lineH + bodyLines.length * lineH + 2;
    if (y + blockH > pageH - 60) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    setColor(doc, BRAND.text);
    doc.text(titleStr, margin + 2, y);
    y += lineH;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.3);
    doc.text(bodyLines, margin + 4, y);
    y += bodyLines.length * lineH + 2;
  });

  if (y + 16 > pageH - 60) { doc.addPage(); y = 20; }
  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setColor(doc, BRAND.primary);
  doc.text('MEMBER DECLARATION', margin + 2, y);
  y += lineH + 1;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  setColor(doc, BRAND.text);
  const decl = doc.splitTextToSize(declaration, pageW - margin * 2 - 4);
  doc.text(decl, margin + 2, y);
  y += decl.length * lineH + 2;

  if (y > pageH - 55) { doc.addPage(); y = 20; }
  y += 8;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  const sigBoxW = (pageW - margin * 2 - 10) / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setColor(doc, BRAND.muted);
  doc.text('MEMBER SIGNATURE', margin, y);
  doc.text('AUTHORIZED STAFF', margin + sigBoxW + 10, y);
  y += 3;

  if (signatureDataUrl) {
    try { doc.addImage(signatureDataUrl, 'PNG', margin, y, sigBoxW, 22); } catch { /* noop */ }
  }

  const sigLineY = y + 26;
  doc.setDrawColor(30, 41, 59);
  doc.line(margin, sigLineY, margin + sigBoxW, sigLineY);
  doc.line(margin + sigBoxW + 10, sigLineY, pageW - margin, sigLineY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setColor(doc, BRAND.muted);
  doc.text(`${data.memberName} • ${fmtDate(new Date().toISOString())}`, margin, sigLineY + 4);
  doc.text('Date: ____________________', margin + sigBoxW + 10, sigLineY + 4);

  footer(doc, resolvedBrand);
  return doc.output('blob');
}

// ============================================================================
// PLAN HELPERS — folded in from former planPdf.ts
// ============================================================================
export function planPdfFilename(plan: { name: string; type: 'workout' | 'diet' }) {
  const safeName = plan.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'plan';
  return `${plan.type === 'workout' ? 'Workout' : 'Diet'}-Plan-${safeName}.pdf`;
}

export async function downloadPlanPdf(input: PlanPdfInput, brand?: BrandContext): Promise<Blob> {
  const blob = await buildPlanPdf(input, brand);
  downloadBlob(blob, planPdfFilename({ name: input.name, type: input.type }));
  return blob;
}

// ============================================================================
// STAFF ROSTER PDF
// ============================================================================
export type RosterScope = 'day' | 'week' | 'month';

export interface RosterShiftLite {
  morning_start: string | null;
  morning_end: string | null;
  evening_start: string | null;
  evening_end: string | null;
  is_weekly_off: boolean;
}

export interface RosterTrainerLite {
  user_id: string;
  full_name: string;
  /** Map weekday (0=Sun…6=Sat) -> shift row */
  shifts: Record<number, RosterShiftLite | undefined>;
}

export interface RosterPdfInput {
  scope: RosterScope;
  /** e.g. "Monday, 25 May 2026" or "Week of 25 May" or "May 2026" */
  periodLabel: string;
  /** For day scope: which weekday (0-6). Ignored otherwise. */
  weekday?: number;
  /** For month scope: anchor date in that month. */
  monthAnchor?: Date;
  trainers: RosterTrainerLite[];
  branchId?: string | null;
  branchName?: string | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtT(t?: string | null) {
  if (!t) return '—';
  const [hStr, mStr] = t.slice(0, 5).split(':');
  let h = Number(hStr);
  const m = mStr;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

function shiftCell(s: RosterShiftLite | undefined): string {
  if (!s) return '—';
  if (s.is_weekly_off) return 'OFF';
  const parts: string[] = [];
  if (s.morning_start && s.morning_end) parts.push(`${fmtT(s.morning_start)}–${fmtT(s.morning_end)}`);
  if (s.evening_start && s.evening_end) parts.push(`${fmtT(s.evening_start)}–${fmtT(s.evening_end)}`);
  return parts.length ? parts.join('\n') : '—';
}

export async function buildStaffRosterPdf(input: RosterPdfInput): Promise<Blob> {
  const landscape = input.scope !== 'day';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' });
  const brand = await resolveBrandAsync(input.branchId ?? null, input.branchName ?? null);
  const title = input.scope === 'day' ? 'DAILY ROSTER'
    : input.scope === 'week' ? 'WEEKLY ROSTER'
    : 'MONTHLY ROSTER';

  header(doc, title, brand, {
    docNumber: input.scope.toUpperCase(),
    issueDate: new Date().toLocaleDateString('en-IN'),
  });

  // Period strip
  let y = 56;
  doc.setFillColor(248, 250, 252);
  const pageW = doc.internal.pageSize.width;
  doc.rect(0, y, pageW, 10, 'F');
  setColor(doc, BRAND.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(input.periodLabel, 14, y + 7);
  setColor(doc, BRAND.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${input.trainers.length} staff member${input.trainers.length === 1 ? '' : 's'}`, pageW - 14, y + 7, { align: 'right' });
  y += 16;

  if (input.scope === 'day') {
    const wd = input.weekday ?? new Date().getDay();
    autoTable(doc, {
      startY: y,
      head: [['Staff', 'Morning Shift', 'Evening Shift', 'Status']],
      body: input.trainers.map((t) => {
        const s = t.shifts[wd];
        if (!s) return [t.full_name, '—', '—', 'Unscheduled'];
        if (s.is_weekly_off) return [t.full_name, '—', '—', 'Weekly Off'];
        const m = s.morning_start && s.morning_end ? `${fmtT(s.morning_start)} – ${fmtT(s.morning_end)}` : '—';
        const e = s.evening_start && s.evening_end ? `${fmtT(s.evening_start)} – ${fmtT(s.evening_end)}` : '—';
        return [t.full_name, m, e, 'Scheduled'];
      }),
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      theme: 'grid',
    });
  } else if (input.scope === 'week') {
    const days = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun
    autoTable(doc, {
      startY: y,
      head: [['Staff', ...days.map((d) => WEEKDAY_LABELS[d])]],
      body: input.trainers.map((t) => [
        t.full_name,
        ...days.map((d) => shiftCell(t.shifts[d])),
      ]),
      styles: { fontSize: 8.5, cellPadding: 2.5, valign: 'middle' },
      headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 } },
      theme: 'grid',
    });
  } else {
    // Month: trainer rows × day-of-month columns, color-coded
    const anchor = input.monthAnchor || new Date();
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayNums = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const head = [['Trainer', ...dayNums.map(String)]];
    const body = input.trainers.map((t) => {
      const cells: string[] = [t.full_name];
      for (const d of dayNums) {
        const wd = new Date(year, month, d).getDay();
        const s = t.shifts[wd];
        if (!s) cells.push('-');
        else if (s.is_weekly_off) cells.push('O');
        else {
          const am = s.morning_start ? 'A' : '';
          const pm = s.evening_start ? 'P' : '';
          cells.push((am + pm) || '-');
        }
      }
      return cells;
    });

    autoTable(doc, {
      startY: y,
      head,
      body,
      styles: { fontSize: 6.5, cellPadding: 1, halign: 'center' },
      headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { fontStyle: 'bold', halign: 'left', cellWidth: 38, fontSize: 8 } },
      theme: 'grid',
      didParseCell: (data) => {
        if (data.section !== 'body' || data.column.index === 0) return;
        const v = String(data.cell.raw ?? '');
        if (v === 'O') { data.cell.styles.fillColor = [219, 234, 254]; data.cell.styles.textColor = [29, 78, 216]; }
        else if (v === 'AP') { data.cell.styles.fillColor = [199, 210, 254]; data.cell.styles.textColor = [55, 48, 163]; }
        else if (v === 'A') { data.cell.styles.fillColor = [209, 250, 229]; data.cell.styles.textColor = [4, 120, 87]; }
        else if (v === 'P') { data.cell.styles.fillColor = [224, 231, 255]; data.cell.styles.textColor = [67, 56, 202]; }
        else if (v === '-') { data.cell.styles.textColor = [148, 163, 184]; }
      },
    });

    // Legend
    const afterY = (doc as any).lastAutoTable?.finalY || y + 100;
    setColor(doc, BRAND.muted);
    doc.setFontSize(8);
    doc.text('Legend:  A = AM shift   P = PM shift   AP = Split shift   O = Weekly off   - = Unscheduled', 14, afterY + 6);
  }

  footer(doc, brand);
  return doc.output('blob');
}
