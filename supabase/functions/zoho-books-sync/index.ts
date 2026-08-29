// zoho-books-sync v1.1.0
// Pushes GST invoices (and their settled payments) from Incline into Zoho Books
// through the Lovable connector gateway. Idempotent: every entity pushed is
// recorded in public.zoho_sync_log and never sent twice.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/zoho_books";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const ZOHO_BOOKS_API_KEY = Deno.env.get("ZOHO_BOOKS_API_KEY");

const PLACE_OF_SUPPLY = "RJ";

type Json = Record<string, unknown>;

async function zoho(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: Json } = {},
): Promise<Json> {
  if (!LOVABLE_API_KEY || !ZOHO_BOOKS_API_KEY) {
    throw new Error("Zoho Books connector is not configured");
  }
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const res = await fetch(`${GATEWAY_URL}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": ZOHO_BOOKS_API_KEY,
      "Content-Type": "application/json",
    },
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

    // v1.2.0 — strict eligibility: genuine GST tax invoices only.
    // Requires positive rate AND tax, excludes BOS / legacy-exempt series and
    // cancelled/draft/refunded documents so exempt invoices never reach Zoho.
    const { data: invoices, error: invErr } = await admin
      .from("invoices")
      .select("id, invoice_number, document_series, subtotal, tax_amount, total_amount, gst_rate, customer_gstin, customer_name, customer_email, customer_phone, member_id, due_date, notes, created_at, status")
      .eq("is_gst_invoice", true)
      .gt("gst_rate", 0)
      .gt("tax_amount", 0)
      .not("status", "in", "(cancelled,draft,refunded)")
      .not("invoice_number", "ilike", "BOS%")
      .order("created_at", { ascending: true });
    if (invErr) throw invErr;

    const pending = (invoices ?? []).filter((i) => !syncedInvoices.has(i.id));

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
          .from("invoice_items").select("description, hsn_code").eq("invoice_id", inv.id);
        const description = (items ?? []).map((i) => i.description).filter(Boolean).join(" · ")
          || "Gym services";
        const hsn = (items ?? []).find((i) => i.hsn_code)?.hsn_code ?? undefined;

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

        let zohoInvoiceId: string;
        try {
          const createdInv = await zoho("POST", "/invoices", {
            query: { ...org, ignore_auto_number_generation: "true" },
            body: invoicePayload,
          });
          zohoInvoiceId = String((createdInv.invoice as Json)?.invoice_id);
        } catch (ce) {
          // Zoho code 1001 = this invoice number already exists (a prior run
          // created it but the log write failed). Adopt it instead of failing.
          const msg = ce instanceof Error ? ce.message : String(ce);
          if (!msg.includes("already exists")) throw ce;
          const found = await zoho("GET", "/invoices", {
            query: { ...org, invoice_number: String(inv.invoice_number) },
          });
          const hit = ((found.invoices as Json[]) ?? [])[0];
          if (!hit) throw ce;
          zohoInvoiceId = String(hit.invoice_id);
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
    return new Response(JSON.stringify({ success: true, organization: orgs[0]?.name, remaining, ...result }), {
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
