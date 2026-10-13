// zoho-books-sync v1.8.0 — vendor bills push (mode "bills") + direct mode from in-app OAuth (settings.zoho_mode) + SAC fallback.
// Pushes GST invoices (and their settled payments) from Incline into Zoho Books
// through the Lovable connector gateway. Idempotent: every entity pushed is
// recorded in public.zoho_sync_log and never sent twice. Because Zoho is called
// with ignore_auto_number_generation, it happily accepts the SAME invoice number
// twice, so every create is preceded by a lookup on invoice_number and adopts an
// existing document instead of creating a twin. POST { mode: "dedupe" } scans the
// synced numbers and removes orphan copies that our log does not own.


import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getMode, loadCreds, refreshAccessToken, type ZohoCreds } from "../_shared/zohoDirect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/zoho_books";

// SAC 999723 = health club & fitness centre services. Membership, PT, add-on and
// benefit lines rarely carry an explicit code, so they fall back to it.
const SERVICE_SAC = "999723";
function hsnFor(items: { hsn_code?: string | null }[]): string {
  return items.find((i) => i.hsn_code)?.hsn_code ?? SERVICE_SAC;
}
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const ZOHO_BOOKS_API_KEY = Deno.env.get("ZOHO_BOOKS_API_KEY");
// Direct mode (optional): own Zoho OAuth app. Used when all three are set;
// otherwise the connector is used. India data centre by default.
// Direct mode: credentials come from the in-app connection (zoho_direct_credentials)
// when settings.zoho_mode = 'direct'; legacy env vars still work as a fallback.
const ENV_CREDS: ZohoCreds | null = Deno.env.get("ZOHO_CLIENT_ID") && Deno.env.get("ZOHO_CLIENT_SECRET") && Deno.env.get("ZOHO_REFRESH_TOKEN")
  ? { client_id: Deno.env.get("ZOHO_CLIENT_ID")!, client_secret: Deno.env.get("ZOHO_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("ZOHO_REFRESH_TOKEN")!, dc: (Deno.env.get("ZOHO_DC") ?? "in") as ZohoCreds["dc"],
      organization_id: null, org_name: null, connected_by: null, connected_at: null, last_test_ok_at: null, last_refresh_error: null }
  : null;
let DIRECT_CREDS: ZohoCreds | null = null;
let directToken: { value: string; exp: number } | null = null;
let onRefreshError: ((msg: string) => Promise<void>) | null = null;

async function directAccessToken(): Promise<string> {
  if (directToken && directToken.exp > Date.now() + 60_000) return directToken.value;
  try {
    const t = await refreshAccessToken(DIRECT_CREDS!);
    directToken = { value: t.token, exp: Date.now() + t.expiresIn * 1000 };
    return directToken.value;
  } catch (e) {
    if (onRefreshError) await onRefreshError((e as Error).message);
    throw e;
  }
}

const PLACE_OF_SUPPLY = "RJ";

type Json = Record<string, unknown>;

async function zoho(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: Json } = {},
): Promise<Json> {
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  let url: string;
  let headers: Record<string, string>;
  if (DIRECT_CREDS) {
    url = `https://www.zohoapis.${DIRECT_CREDS.dc}/books/v3${path}${qs}`;
    headers = { Authorization: `Zoho-oauthtoken ${await directAccessToken()}`, "Content-Type": "application/json" };
  } else {
    if (!LOVABLE_API_KEY || !ZOHO_BOOKS_API_KEY) {
      throw new Error("Zoho Books is not linked (connector or direct credentials missing)");
    }
    url = `${GATEWAY_URL}${path}${qs}`;
    headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": ZOHO_BOOKS_API_KEY,
      "Content-Type": "application/json",
    };
  }
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = JSON.parse(text); } catch { /* non-json */ }
  if (!res.ok) {
    throw new Error(`[${res.status}] ${text.slice(0, 600)}`);
  }
  if (typeof parsed.code === "number" && parsed.code !== 0) {
    throw new Error(`[zoho ${parsed.code}] ${String(parsed.message ?? text).slice(0, 600)}`);
  }
  return parsed;
}

/** Zoho rejects < and > anywhere in a payload string. */
function clean(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const out = String(v).replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  return out.length ? out : undefined;
}

const PAYMENT_MODE: Record<string, string> = {
  cash: "cash",
  card: "creditcard",
  upi: "banktransfer",
  bank_transfer: "banktransfer",
  wallet: "other",
  cheque: "check",
  other: "other",
};

function istDate(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ---- authz: owner/admin only -------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) {
      return new Response(JSON.stringify({ success: false, error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", uid);
    const allowed = (roles ?? []).some((r) => r.role === "owner" || r.role === "admin");
    if (!allowed) {
      return new Response(JSON.stringify({ success: false, error: "Owner or admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 25, 50);
    const dryRun = Boolean(body.dryRun);
    const mode = String(body.mode ?? "sync");

    // ---- connection mode (kill switch) --------------------------------------
    DIRECT_CREDS = null;
    if ((await getMode(admin)) === "direct") {
      const c = await loadCreds(admin);
      if (!c?.refresh_token) throw new Error("Direct Zoho mode is on but not connected — reconnect in Finance → GST");
      DIRECT_CREDS = c;
      onRefreshError = async (msg) => {
        await admin.from("zoho_direct_credentials").update({ last_refresh_error: msg }).eq("id", true);
        await admin.rpc("log_error_event", { p_source: "zoho-books-sync", p_message: msg, p_severity: "error" }).then(() => {}, () => {});
      };
    } else if (ENV_CREDS) {
      DIRECT_CREDS = ENV_CREDS;
    }


    // ---- org + tax lookup ---------------------------------------------------
    const orgRes = await zoho("GET", "/organizations");
    const orgs = (orgRes.organizations as Json[]) ?? [];
    const orgId = String(orgs[0]?.organization_id ?? "");
    if (!orgId) throw new Error("No Zoho Books organization available");
    const org = { organization_id: orgId };

    const taxRes = await zoho("GET", "/settings/taxes", { query: org });
    const taxes = ((taxRes.taxes as Json[]) ?? []).filter(
      (t) => t.tax_specification === "intra" || t.tax_type === "tax_group",
    );
    const taxIdForRate = (rate: number): string | null => {
      const match = taxes.find((t) => Number(t.tax_percentage) === Number(rate));
      return match ? String(match.tax_id) : null;
    };

    // ---- reconciliation audit (read-only) ------------------------------------
    if (mode === "audit") {
      const zInv: Json[] = [];
      for (let page = 1; page <= 20; page++) {
        const r = await zoho("GET", "/invoices", { query: { ...org, per_page: "200", page: String(page) } });
        zInv.push(...((r.invoices as Json[]) ?? []));
        if (!(r.page_context as Json)?.has_more_page) break;
      }
      const { data: appInv } = await admin
        .from("invoices")
        .select("id, invoice_number, total_amount, amount_paid, status, created_at, customer_name")
        .eq("is_gst_invoice", true).eq("is_proforma", false)
        .gt("gst_rate", 0).gt("tax_amount", 0)
        .not("status", "in", "(cancelled,draft,refunded)")
        .not("invoice_number", "ilike", "BOS%");
      const { data: payRows } = await admin
        .from("payments").select("invoice_id, amount").eq("status", "completed")
        .in("invoice_id", (appInv ?? []).map((i) => i.id));
      const paidByInv = new Map<string, number>();
      for (const p of payRows ?? []) paidByInv.set(p.invoice_id as string, (paidByInv.get(p.invoice_id as string) ?? 0) + Number(p.amount));
      const zByNum = new Map<string, Json[]>();
      for (const z of zInv) {
        const n = String(z.invoice_number);
        zByNum.set(n, [...(zByNum.get(n) ?? []), z]);
      }
      const appNums = new Set((appInv ?? []).map((i) => String(i.invoice_number)));
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const report = {
        app_invoices: appInv?.length ?? 0, zoho_invoices: zInv.length,
        missing_in_zoho: [] as unknown[], only_in_zoho: [] as unknown[], duplicates_in_zoho: [] as unknown[],
        total_mismatch: [] as unknown[], paid_mismatch: [] as unknown[], overpaid_in_app: [] as unknown[],
      };
      for (const a of appInv ?? []) {
        const n = String(a.invoice_number);
        const zs = zByNum.get(n) ?? [];
        const paid = r2(paidByInv.get(a.id) ?? 0);
        const total = r2(Number(a.total_amount));
        if (paid > total + 0.5) report.overpaid_in_app.push({ n, name: a.customer_name, total, paid });
        if (!zs.length) { report.missing_in_zoho.push({ n, name: a.customer_name, total, created: a.created_at }); continue; }
        if (zs.length > 1) report.duplicates_in_zoho.push({ n, copies: zs.length });
        const z = zs[0];
        const zTotal = r2(Number(z.total)); const zPaid = r2(zTotal - Number(z.balance));
        if (Math.abs(zTotal - total) > 0.5) report.total_mismatch.push({ n, name: a.customer_name, app: total, zoho: zTotal });
        if (!z.hsn_or_sac && z.line_items === undefined) { /* list view lacks lines */ }
        if (Math.abs(zPaid - Math.min(paid, total)) > 0.5) report.paid_mismatch.push({ n, name: a.customer_name, app_paid: paid, zoho_paid: zPaid, zoho_status: z.status });
      }
      for (const n of zByNum.keys()) if (!appNums.has(n)) report.only_in_zoho.push({ n, total: zByNum.get(n)![0].total, status: zByNum.get(n)![0].status });
      return new Response(JSON.stringify({ success: true, organization: orgs[0]?.name, ...report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- v1.6.0 HSN/SAC repair: fill missing SAC on already-pushed invoices ----
    if (mode === "fix_hsn") {
      const { data: logRows } = await admin
        .from("zoho_sync_log").select("entity_id, zoho_id")
        .eq("entity_type", "invoice").eq("status", "synced");
      const report = { checked: 0, fixed: 0, already_ok: 0, errors: [] as string[] };
      for (const row of (logRows ?? []).slice(0, Math.min(Number(body.limit) || 300, 400))) {
        report.checked++;
        try {
          const { data: items } = await admin
            .from("invoice_items").select("hsn_code, reference_type").eq("invoice_id", row.entity_id);
          const code = hsnFor(items ?? []);
          let zid = String(row.zoho_id);
          let zi: Json;
          try {
            zi = (await zoho("GET", `/invoices/${zid}`, { query: org })).invoice as Json;
          } catch (e) {
            // Logged copy was deleted in Zoho: repoint the log to the live copy.
            if (!String(e).includes("404")) throw e;
            const { data: li } = await admin.from("invoices").select("invoice_number").eq("id", row.entity_id).maybeSingle();
            const hit = (((await zoho("GET", "/invoices", { query: { ...org, invoice_number: String(li?.invoice_number) } })).invoices as Json[]) ?? [])
              .find((i) => String(i.invoice_number) === String(li?.invoice_number));
            if (!hit) throw e;
            zid = String(hit.invoice_id);
            await admin.from("zoho_sync_log").update({ zoho_id: zid }).eq("entity_type", "invoice").eq("entity_id", row.entity_id);
            zi = (await zoho("GET", `/invoices/${zid}`, { query: org })).invoice as Json;
          }
          const lines = (zi?.line_items as Json[]) ?? [];
          if (lines.every((l) => l.hsn_or_sac)) { report.already_ok++; continue; }
          await zoho("PUT", `/invoices/${zid}`, {
            query: org,
            body: {
              customer_id: zi.customer_id,
              line_items: lines.map((l) => ({
                line_item_id: l.line_item_id, name: l.name, description: l.description,
                rate: l.rate, quantity: l.quantity, tax_id: l.tax_id,
                hsn_or_sac: l.hsn_or_sac || code,
              })),
            },
          });
          report.fixed++;
        } catch (e) {
          report.errors.push(`${row.entity_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return new Response(JSON.stringify({ success: true, mode: "fix_hsn", ...report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- v1.8.0 vendor bills: push purchase bills (expenses kind=vendor_bill) ----
    // Creates/uses a Zoho vendor contact (GSTIN-aware) and posts a Bill per
    // expense, one line per expense_items row with its HSN and 5% intra tax.
    // Idempotent via zoho_sync_log entity_type 'bill' + bill_number lookup.
    if (mode === "bills") {
      const { data: billLog } = await admin
        .from("zoho_sync_log").select("entity_id, zoho_id, entity_type")
        .in("entity_type", ["bill", "contact"]).eq("status", "synced");
      const doneBills = new Set((billLog ?? []).filter((r) => r.entity_type === "bill").map((r) => r.entity_id));
      const contactMap = new Map(
        (billLog ?? []).filter((r) => r.entity_type === "contact").map((r) => [r.entity_id, r.zoho_id!]),
      );

      const { data: vendorBills, error: vbErr } = await admin
        .from("expenses")
        .select("id, bill_number, vendor, vendor_gstin, expense_date, amount, taxable_amount, gst_rate, status")
        .eq("expense_type", "vendor_bill")
        .not("bill_number", "is", null)
        .eq("status", "approved")
        .order("expense_date", { ascending: true });
      if (vbErr) throw vbErr;

      // Zoho bills require an expense account per line. Prefer a purchases /
      // cost-of-goods account, else the first expense account.
      const coa = ((await zoho("GET", "/chartofaccounts", { query: org })).chartofaccounts as Json[]) ?? [];
      const pick = (preds: ((a: Json) => boolean)[]) => {
        for (const p of preds) { const hit = coa.find(p); if (hit) return String(hit.account_id); }
        return null;
      };
      const expenseAccountId = pick([
        (a) => a.account_type === "cost_of_goods_sold" && /purchase|cost of goods/i.test(String(a.account_name)),
        (a) => a.account_type === "cost_of_goods_sold",
        (a) => a.account_type === "expense" && /purchase|supplement|stock|inventory/i.test(String(a.account_name)),
        (a) => a.account_type === "expense",
      ]);
      if (!expenseAccountId) throw new Error("No expense account found in Zoho chart of accounts");

      const pendingBills = (vendorBills ?? []).filter((b) => !doneBills.has(b.id));
      if (dryRun) {
        return new Response(JSON.stringify({
          success: true, dryRun: true, mode: "bills",
          vendor_bills: vendorBills?.length ?? 0, pending: pendingBills.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const billResult = { bills_synced: 0, bills_failed: 0, errors: [] as string[] };
      for (const bill of pendingBills.slice(0, limit)) {
        try {
          const { data: lines } = await admin
            .from("expense_items")
            .select("item_name, hsn_code, quantity, rate, gst_rate")
            .eq("expense_id", bill.id);
          if (!lines?.length) throw new Error("no line items");

          // --- vendor contact -------------------------------------------------
          const vendorKey = `vendor:${String(bill.vendor).trim().toLowerCase()}`;
          let vendorId = contactMap.get(vendorKey);
          if (!vendorId) {
            const gstin = clean(bill.vendor_gstin as string);
            const payload: Json = {
              contact_name: clean(bill.vendor as string),
              contact_type: "vendor",
              gst_treatment: gstin ? "business_gst" : "consumer",
              place_of_contact: PLACE_OF_SUPPLY,
              ...(gstin ? { gst_no: gstin } : {}),
            };
            try {
              const created = await zoho("POST", "/contacts", { query: org, body: payload });
              vendorId = String((created.contact as Json)?.contact_id);
            } catch (e) {
              const found = await zoho("GET", "/contacts", {
                query: { ...org, contact_name: String(payload.contact_name) },
              });
              const hit = ((found.contacts as Json[]) ?? [])[0];
              if (!hit) throw e;
              vendorId = String(hit.contact_id);
            }
            contactMap.set(vendorKey, vendorId);
            await admin.from("zoho_sync_log").upsert({
              entity_type: "contact", entity_id: vendorKey, zoho_id: vendorId,
              zoho_org_id: orgId, status: "synced", synced_at: new Date().toISOString(), error: null,
            }, { onConflict: "entity_type,entity_id" });
          }

          // --- adopt existing bill with the same number, else create -----------
          const existing = ((await zoho("GET", "/bills", {
            query: { ...org, bill_number: String(bill.bill_number) },
          })).bills as Json[]) ?? [];
          const hit = existing.find((b) => String(b.bill_number) === String(bill.bill_number));
          let zohoBillId: string;
          if (hit) {
            zohoBillId = String(hit.bill_id);
          } else {
            const created = await zoho("POST", "/bills", {
              query: { ...org, ignore_auto_number_generation: "true" },
              body: {
                vendor_id: vendorId,
                bill_number: clean(bill.bill_number as string),
                date: istDate(bill.expense_date as string),
                is_inclusive_tax: false,
                line_items: lines.map((l) => ({
                  name: clean(l.item_name as string),
                  account_id: expenseAccountId,
                  rate: Number(l.rate),
                  quantity: Number(l.quantity),
                  hsn_or_sac: clean(l.hsn_code as string),
                  ...(taxIdForRate(Number(l.gst_rate)) ? { tax_id: taxIdForRate(Number(l.gst_rate)) } : {}),
                })),
              },
            });
            zohoBillId = String((created.bill as Json)?.bill_id ?? "");
          }

          await admin.from("zoho_sync_log").upsert({
            entity_type: "bill", entity_id: bill.id, zoho_id: zohoBillId,
            zoho_org_id: orgId, status: "synced", error: null, synced_at: new Date().toISOString(),
          }, { onConflict: "entity_type,entity_id" });
          billResult.bills_synced++;
        } catch (e) {
          billResult.bills_failed++;
          const msg = e instanceof Error ? e.message : String(e);
          billResult.errors.push(`${bill.bill_number}: ${msg}`);
          await admin.from("zoho_sync_log").upsert({
            entity_type: "bill", entity_id: bill.id, zoho_org_id: orgId,
            status: "failed", error: msg,
          }, { onConflict: "entity_type,entity_id" });
        }
      }
      return new Response(JSON.stringify({ success: true, mode: "bills", ...billResult }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    /** Every Zoho invoice carrying this exact invoice number. */
    const invoicesByNumber = async (number: string): Promise<Json[]> => {
      const found = await zoho("GET", "/invoices", {
        query: { ...org, invoice_number: number },
      });
      return ((found.invoices as Json[]) ?? []).filter(
        (i) => String(i.invoice_number) === number,
      );
    };

    // ---- duplicate cleanup ---------------------------------------------------
    // Removes twin documents created before v1.4.0 (concurrent/retried runs).
    // The copy referenced by zoho_sync_log is kept; extra copies are deleted when
    // they carry no payment, otherwise reported for manual review.
    if (mode === "dedupe") {
      const { data: logRows } = await admin
        .from("zoho_sync_log").select("entity_id, zoho_id")
        .eq("entity_type", "invoice").eq("status", "synced");
      const owned = new Map((logRows ?? []).map((r) => [r.entity_id, String(r.zoho_id)]));
      const { data: localInvoices } = await admin
        .from("invoices").select("id, invoice_number")
        .in("id", [...owned.keys()]);

      const report = { checked: 0, duplicates: 0, deleted: 0, needs_review: [] as string[], errors: [] as string[] };
      for (const inv of (localInvoices ?? []).slice(0, Math.min(Number(body.limit) || 200, 300))) {
        report.checked++;
        try {
          const copies = await invoicesByNumber(String(inv.invoice_number));
          if (copies.length < 2) continue;
          const keep = owned.get(inv.id);
          for (const copy of copies) {
            const id = String(copy.invoice_id);
            if (id === keep) continue;
            report.duplicates++;
            const paid = Number(copy.total ?? 0) - Number(copy.balance ?? 0);
            if (paid > 0) { report.needs_review.push(`${inv.invoice_number} (${id}, ₹${paid} applied)`); continue; }
            try {
              await zoho("POST", `/invoices/${id}/status/void`, { query: org });
            } catch { /* draft/void already */ }
            await zoho("DELETE", `/invoices/${id}`, { query: org });
            report.deleted++;
          }
        } catch (e) {
          report.errors.push(`${inv.invoice_number}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return new Response(JSON.stringify({ success: true, mode: "dedupe", ...report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // ---- candidate invoices -------------------------------------------------
    const { data: synced } = await admin
      .from("zoho_sync_log").select("entity_id, zoho_id, entity_type, status")
      .in("status", ["synced"]);
    const syncedInvoices = new Set(
      (synced ?? []).filter((r) => r.entity_type === "invoice").map((r) => r.entity_id),
    );
    const syncedPayments = new Set(
      (synced ?? []).filter((r) => r.entity_type === "payment").map((r) => r.entity_id),
    );
    const contactMap = new Map(
      (synced ?? []).filter((r) => r.entity_type === "contact").map((r) => [r.entity_id, r.zoho_id!]),
    );
    const zohoInvoiceIdByLocal = new Map(
      (synced ?? []).filter((r) => r.entity_type === "invoice").map((r) => [r.entity_id, r.zoho_id!]),
    );

    // v1.3.0 — strict eligibility (renewal offers/proformas excluded): genuine GST tax invoices only.
    // Requires positive rate AND tax, excludes BOS / legacy-exempt series and
    // cancelled/draft/refunded documents so exempt invoices never reach Zoho.
    const { data: invoices, error: invErr } = await admin
      .from("invoices")
      .select("id, invoice_number, document_series, subtotal, tax_amount, total_amount, gst_rate, customer_gstin, customer_name, customer_email, customer_phone, member_id, due_date, notes, created_at, status")
      .eq("is_gst_invoice", true)
      .eq("is_proforma", false)
      .gt("gst_rate", 0)
      .gt("tax_amount", 0)
      .not("status", "in", "(cancelled,draft,refunded)")
      .not("invoice_number", "ilike", "BOS%")
      .order("created_at", { ascending: true });
    if (invErr) throw invErr;

    const pending = (invoices ?? []).filter((i) => !syncedInvoices.has(i.id));

    // ---- v1.5.0 catch-up: instalments paid AFTER the invoice was pushed ------
    // Previously only invoices still pending were scanned for payments, so a
    // second instalment on an already-synced invoice never reached Zoho. Each
    // payment is applied only up to the Zoho balance; if Zoho already shows the
    // invoice settled, the payment is logged as already applied, not re-posted.
    const catchup = { synced: 0, already_applied: 0, failed: 0 };
    if (!dryRun) {
      const syncedIds = (invoices ?? []).filter((i) => zohoInvoiceIdByLocal.has(i.id)).map((i) => i.id);
      const { data: latePays } = syncedIds.length ? await admin
        .from("payments")
        .select("id, invoice_id, amount, payment_method, payment_date, transaction_id, notes")
        .in("invoice_id", syncedIds).eq("status", "completed").gt("amount", 0)
        .order("payment_date", { ascending: true }) : { data: [] };
      const todo = (latePays ?? []).filter((p) => !syncedPayments.has(p.id)).slice(0, 30);
      for (const p of todo) {
        const zid = zohoInvoiceIdByLocal.get(p.invoice_id as string)!;
        try {
          const zi = (await zoho("GET", `/invoices/${zid}`, { query: org })).invoice as Json;
          const balance = Number(zi?.balance ?? 0);
          const apply = Math.min(Number(p.amount), balance);
          let zohoPaymentId = "already_applied";
          if (apply > 0.009) {
            const created = await zoho("POST", "/customerpayments", {
              query: org,
              body: {
                customer_id: zi.customer_id,
                payment_mode: PAYMENT_MODE[p.payment_method as string] ?? "other",
                amount: apply,
                date: istDate(p.payment_date as string),
                reference_number: clean(p.transaction_id as string),
                description: clean(p.notes as string),
                invoices: [{ invoice_id: zid, amount_applied: apply }],
              },
            });
            zohoPaymentId = String((created.payment as Json)?.payment_id ?? "");
            catchup.synced++;
          } else {
            catchup.already_applied++;
          }
          syncedPayments.add(p.id);
          await admin.from("zoho_sync_log").upsert({
            entity_type: "payment", entity_id: p.id, zoho_id: zohoPaymentId,
            zoho_org_id: orgId, status: "synced", error: null, synced_at: new Date().toISOString(),
          }, { onConflict: "entity_type,entity_id" });
        } catch (e) {
          catchup.failed++;
          await admin.from("zoho_sync_log").upsert({
            entity_type: "payment", entity_id: p.id, zoho_org_id: orgId,
            status: "failed", error: e instanceof Error ? e.message : String(e),
          }, { onConflict: "entity_type,entity_id" });
        }
      }
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true, dryRun: true, organization: orgs[0]?.name,
        gst_invoices: invoices?.length ?? 0, pending: pending.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const batch = pending.slice(0, limit);
    const result = { invoices_synced: 0, invoices_failed: 0, payments_synced: 0, payments_failed: 0, errors: [] as string[] };

    for (const inv of batch) {
      try {
        // --- customer -------------------------------------------------------
        let member: { full_name?: string; email?: string; phone?: string; gstin?: string } | null = null;
        if (inv.member_id) {
          const { data: mem } = await admin
            .from("members").select("id, user_id, gstin").eq("id", inv.member_id).maybeSingle();
          if (mem) {
            const { data: prof } = mem.user_id
              ? await admin.from("profiles").select("full_name, email, phone").eq("id", mem.user_id).maybeSingle()
              : { data: null };
            member = {
              full_name: prof?.full_name ?? undefined,
              email: prof?.email ?? undefined,
              phone: prof?.phone ?? undefined,
              gstin: mem.gstin ?? undefined,
            };
          }
        }
        const gstin = inv.customer_gstin || member?.gstin || null;
        const contactKey = (inv.member_id ?? inv.id) as string;
        let customerId = contactMap.get(contactKey);

        if (!customerId) {
          const name = clean(inv.customer_name || member?.full_name) || "Walk-in Customer";
          const email = (inv.customer_email || member?.email || null) as string | null;
          const phone = (inv.customer_phone || member?.phone || null) as string | null;
          const payload: Json = {
            contact_name: `${name}${inv.member_id ? "" : ` (${inv.invoice_number})`}`,
            contact_type: "customer",
            customer_sub_type: "individual",
            gst_treatment: gstin ? "business_gst" : "consumer",
            place_of_contact: PLACE_OF_SUPPLY,
            ...(gstin ? { gst_no: gstin } : {}),

            contact_persons: [{
              first_name: name.split(" ")[0],
              last_name: name.split(" ").slice(1).join(" ") || undefined,
              email: clean(email),
              phone: clean(phone),
              is_primary_contact: true,
            }],
          };
          try {
            const created = await zoho("POST", "/contacts", { query: org, body: payload });
            customerId = String((created.contact as Json)?.contact_id);
          } catch (e) {
            // duplicate name -> look it up instead
            const found = await zoho("GET", "/contacts", {
              query: { ...org, contact_name: String(payload.contact_name) },
            });
            const hit = ((found.contacts as Json[]) ?? [])[0];
            if (!hit) throw e;
            customerId = String(hit.contact_id);
          }
          contactMap.set(contactKey, customerId);
          await admin.from("zoho_sync_log").upsert({
            entity_type: "contact", entity_id: contactKey, zoho_id: customerId,
            zoho_org_id: orgId, status: "synced", synced_at: new Date().toISOString(), error: null,
          }, { onConflict: "entity_type,entity_id" });
        }

        // --- invoice ---------------------------------------------------------
        const rate = Number(inv.gst_rate ?? 0);
        const taxId = taxIdForRate(rate);
        if (!taxId) throw new Error(`No Zoho tax configured for GST ${rate}%`);

        const { data: items } = await admin
          .from("invoice_items").select("description, hsn_code, reference_type").eq("invoice_id", inv.id);
        const description = (items ?? []).map((i) => i.description).filter(Boolean).join(" · ")
          || "Gym services";
        const hsn = hsnFor(items ?? []);

        // Zoho rounds CGST/SGST halves independently; mirror that and post the
        // 1-paisa delta as an adjustment so Zoho's total equals our invoice total.
        const subtotal = Number(inv.subtotal);
        const halfTax = Math.round((subtotal * rate / 200) * 100) / 100;
        const zohoTotal = Math.round((subtotal + halfTax * 2) * 100) / 100;
        const adjustment = Math.round((Number(inv.total_amount) - zohoTotal) * 100) / 100;

        const invoicePayload: Json = {
          customer_id: customerId,
          invoice_number: inv.invoice_number,
          reference_number: inv.invoice_number,
          date: istDate(inv.created_at),
          ...(inv.due_date ? { due_date: inv.due_date } : {}),
          place_of_supply: PLACE_OF_SUPPLY,
          gst_treatment: gstin ? "business_gst" : "consumer",
          ...(gstin ? { gst_no: gstin } : {}),
          ...(adjustment !== 0
            ? { adjustment, adjustment_description: "Rounding" }
            : {}),
          notes: clean(inv.notes),
          line_items: [{
            name: (clean(description) || "Gym services").slice(0, 100),
            description: (clean(description) || "Gym services").slice(0, 2000),
            rate: subtotal,
            quantity: 1,
            tax_id: taxId,
            ...(hsn ? { hsn_or_sac: hsn } : {}),
          }],
        };

        // Pre-flight: Zoho accepts duplicate numbers when auto-numbering is
        // ignored, so never create blindly — adopt an existing document first.
        let zohoInvoiceId: string;
        const existing = await invoicesByNumber(String(inv.invoice_number));
        if (existing.length) {
          zohoInvoiceId = String(existing[0].invoice_id);
        } else {
          try {
            const createdInv = await zoho("POST", "/invoices", {
              query: { ...org, ignore_auto_number_generation: "true" },
              body: invoicePayload,
            });
            zohoInvoiceId = String((createdInv.invoice as Json)?.invoice_id);
          } catch (ce) {
            // Zoho code 1001 = this invoice number already exists (a racing run
            // created it). Adopt it instead of failing.
            const msg = ce instanceof Error ? ce.message : String(ce);
            if (!msg.includes("already exists")) throw ce;
            const hit = (await invoicesByNumber(String(inv.invoice_number)))[0];
            if (!hit) throw ce;
            zohoInvoiceId = String(hit.invoice_id);
          }
        }

        zohoInvoiceIdByLocal.set(inv.id, zohoInvoiceId);

        // Move out of draft so it appears in receivables / GST reports.
        try {
          await zoho("POST", `/invoices/${zohoInvoiceId}/status/sent`, { query: org });
        } catch (_e) { /* already sent */ }


        await admin.from("zoho_sync_log").upsert({
          entity_type: "invoice", entity_id: inv.id, zoho_id: zohoInvoiceId,
          zoho_org_id: orgId, status: "synced", error: null,
          synced_at: new Date().toISOString(),
        }, { onConflict: "entity_type,entity_id" });
        result.invoices_synced++;

        // --- payments ---------------------------------------------------------
        const { data: payments } = await admin
          .from("payments")
          .select("id, amount, payment_method, payment_date, transaction_id, notes, status")
          .eq("invoice_id", inv.id)
          .eq("status", "completed")
          .order("payment_date", { ascending: true });

        for (const p of payments ?? []) {
          if (syncedPayments.has(p.id) || Number(p.amount) <= 0) continue;
          try {
            const created = await zoho("POST", "/customerpayments", {
              query: org,
              body: {
                customer_id: customerId,
                payment_mode: PAYMENT_MODE[p.payment_method as string] ?? "other",
                amount: Number(p.amount),
                date: istDate(p.payment_date),
                reference_number: clean(p.transaction_id),
                description: clean(p.notes),
                invoices: [{ invoice_id: zohoInvoiceId, amount_applied: Number(p.amount) }],
              },
            });
            await admin.from("zoho_sync_log").upsert({
              entity_type: "payment", entity_id: p.id,
              zoho_id: String((created.payment as Json)?.payment_id ?? ""),
              zoho_org_id: orgId, status: "synced", error: null,
              synced_at: new Date().toISOString(),
            }, { onConflict: "entity_type,entity_id" });
            result.payments_synced++;
          } catch (pe) {
            result.payments_failed++;
            const msg = pe instanceof Error ? pe.message : String(pe);
            result.errors.push(`payment ${p.id}: ${msg}`);
            await admin.from("zoho_sync_log").upsert({
              entity_type: "payment", entity_id: p.id, zoho_org_id: orgId,
              status: "failed", error: msg,
            }, { onConflict: "entity_type,entity_id" });
          }
        }
      } catch (e) {
        result.invoices_failed++;
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`${inv.invoice_number}: ${msg}`);
        await admin.from("zoho_sync_log").upsert({
          entity_type: "invoice", entity_id: inv.id, zoho_org_id: orgId,
          status: "failed", error: msg,
        }, { onConflict: "entity_type,entity_id" });
      }
    }

    const remaining = Math.max(pending.length - batch.length, 0);
    return new Response(JSON.stringify({ success: true, organization: orgs[0]?.name, remaining, ...result, catchup }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await admin.rpc("log_error_event", {
        p_source: "zoho-books-sync", p_severity: "error", p_message: msg,
      } as never);
    } catch { /* best effort */ }
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
