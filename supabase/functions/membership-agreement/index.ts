// membership-agreement v1.0.0
//
// The ONE place the Membership Registration & Agreement is produced for
// existing members. Every copy (stored, viewed, printed, downloaded) comes from
// `_shared/membershipAgreementPdf.ts`, so there is never an "old form".
//
// Actions (POST JSON `{ action, ... }`):
//   get      { member_id }            staff of the member's branch, or the member themself.
//                                     Guarantees the canonical PDF exists (renders it when
//                                     missing or legacy) and returns a short-lived signed URL.
//   preview  { member_id, draft }     staff only. Unsigned DRAFT with the staff member's
//                                     in-progress edits (watermarked, never stored).
//   sign     { member_id, ... }       staff only. Stores signature + legal record + PDF.
//   backfill { limit, dry_run, force } owner/admin only. Regenerates legacy agreements
//                                     into the unified document (idempotent, batched).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureEdgeError } from "../_shared/capture-edge-error.ts";
import {
  canActOnBranch,
  requireCaller,
  STAFF_ROLES,
  type CallerResult,
} from "../_shared/requireCaller.ts";
import {
  AGREEMENT_ACKNOWLEDGEMENTS,
  AGREEMENT_VERSION,
  acknowledgementsFromSignedRecord,
  agreementReference,
  normaliseParq,
  REQUIRED_ACKNOWLEDGEMENT_KEYS,
} from "../_shared/agreement.ts";
import {
  renderMembershipAgreementPdf,
  type AgreementRenderInput,
} from "../_shared/membershipAgreementPdf.ts";

const FN = "membership-agreement";
const RENDERER = "membershipAgreementPdf/1.0.0";
const BUCKET = "member-onboarding";
const SIGNED_URL_TTL = 120;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const canonicalPath = (memberId: string) => `${memberId}/membership-agreement.pdf`;
const agreementFilename = (code: string | null, memberId: string) =>
  `Membership-Agreement-${(code || memberId.slice(0, 8)).replace(/[^A-Za-z0-9-]/g, "")}.pdf`;

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

// ---------------------------------------------------------------------------
// Data bundle
// ---------------------------------------------------------------------------
interface MemberRow {
  id: string;
  user_id: string | null;
  branch_id: string | null;
  member_code: string | null;
  fitness_goals: string | null;
  health_conditions: string | null;
  joined_at: string | null;
}
interface ProfileRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  date_of_birth: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  government_id_type: string | null;
  government_id_number: string | null;
}
interface SignatureRow {
  id: string;
  member_id: string;
  signature_path: string | null;
  waiver_pdf_path: string | null;
  par_q: Record<string, unknown> | null;
  consents: Record<string, unknown> | null;
  custom_terms: string | null;
  terms_version: string | null;
  signer_ip: string | null;
  signed_at: string | null;
}
interface Bundle {
  member: MemberRow;
  profile: ProfileRow | null;
  branch: { id: string; name: string; phone: string | null; email: string | null } | null;
  membership: { plan_name: string | null; price_paid: number | null; start_date: string | null; end_date: string | null } | null;
  sigRow: SignatureRow | null;
}

async function loadBundle(admin: SupabaseClient, memberId: string): Promise<Bundle | null> {
  const { data: member, error } = await admin
    .from("members")
    .select("id, user_id, branch_id, member_code, fitness_goals, health_conditions, joined_at")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!member) return null;

  const [profileRes, branchRes, sigRes] = await Promise.all([
    member.user_id
      ? admin
        .from("profiles")
        .select(
          "full_name, email, phone, gender, date_of_birth, address, city, state, postal_code, emergency_contact_name, emergency_contact_phone, government_id_type, government_id_number",
        )
        .eq("id", member.user_id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    member.branch_id
      ? admin.from("branches").select("id, name, phone, email").eq("id", member.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("member_onboarding_signatures")
      .select("id, member_id, signature_path, waiver_pdf_path, par_q, consents, custom_terms, terms_version, signer_ip, signed_at")
      .eq("member_id", memberId)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Part B: the live plan first, else the most recent one.
  let membership: Bundle["membership"] = null;
  const pickMembership = async (statuses: string[] | null) => {
    let q = admin
      .from("memberships")
      .select("plan_id, price_paid, start_date, end_date, status")
      .eq("member_id", memberId)
      .order("start_date", { ascending: false })
      .limit(1);
    if (statuses) q = q.in("status", statuses);
    const { data } = await q.maybeSingle();
    return data as { plan_id: string | null; price_paid: number | null; start_date: string | null; end_date: string | null } | null;
  };
  const live = (await pickMembership(["active", "frozen"])) ?? (await pickMembership(null));
  if (live) {
    let planName: string | null = null;
    if (live.plan_id) {
      const { data: plan } = await admin.from("membership_plans").select("name").eq("id", live.plan_id).maybeSingle();
      planName = (plan as { name: string } | null)?.name ?? null;
    }
    membership = { plan_name: planName, price_paid: live.price_paid, start_date: live.start_date, end_date: live.end_date };
  }

  return {
    member: member as MemberRow,
    profile: (profileRes.data ?? null) as ProfileRow | null,
    branch: (branchRes.data ?? null) as Bundle["branch"],
    membership,
    sigRow: (sigRes.data ?? null) as SignatureRow | null,
  };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return png || jpg;
}

async function downloadBytes(admin: SupabaseClient, bucket: string, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Find the member's stored signature image, wherever an older flow put it. */
async function loadSignatureBytes(admin: SupabaseClient, memberId: string, sigRow: SignatureRow | null): Promise<Uint8Array | null> {
  const candidates: Array<{ bucket: string; path: string }> = [];
  const preferred = String(sigRow?.consents?.pdf_bucket ?? BUCKET);
  if (sigRow?.signature_path && !/\.pdf$/i.test(sigRow.signature_path)) {
    candidates.push({ bucket: preferred, path: sigRow.signature_path });
    if (preferred !== BUCKET) candidates.push({ bucket: BUCKET, path: sigRow.signature_path });
  }
  candidates.push({ bucket: BUCKET, path: `${memberId}/signature.png` });
  candidates.push({ bucket: "documents", path: `${memberId}/signature.png` });
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = `${c.bucket}:${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bytes = await downloadBytes(admin, c.bucket, c.path);
    if (bytes && looksLikeImage(bytes)) return bytes;
  }
  return null;
}

async function objectExists(admin: SupabaseClient, bucket: string, path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const folder = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const { data, error } = await admin.storage.from(bucket).list(folder, { search: name, limit: 20 });
  if (error || !data) return false;
  return data.some((o: { name: string }) => o.name === name);
}

// Organisation logo (optional) — cached per isolate.
let logoCache: { url: string | null; bytes: Uint8Array | null; at: number } | null = null;
async function loadOrgLogo(admin: SupabaseClient): Promise<Uint8Array | null> {
  if (logoCache && Date.now() - logoCache.at < 10 * 60_000) return logoCache.bytes;
  let url: string | null = null;
  try {
    const { data } = await admin.from("organization_settings").select("logo_url").is("branch_id", null).limit(1).maybeSingle();
    url = (data as { logo_url?: string | null } | null)?.logo_url ?? null;
  } catch { /* optional */ }
  let bytes: Uint8Array | null = null;
  if (url && /^https:\/\//i.test(url)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= 2_000_000 && looksLikeImage(buf)) bytes = buf;
      }
    } catch { /* fall back to embedded wordmark */ }
  }
  logoCache = { url, bytes, at: Date.now() };
  return bytes;
}

// ---------------------------------------------------------------------------
// Render + store
// ---------------------------------------------------------------------------
interface DraftOverrides {
  government_id_type?: string | null;
  government_id_number?: string | null;
  fitness_goals?: string | null;
  health_conditions?: string | null;
  par_q?: Record<string, unknown> | null;
  acknowledgements?: Record<string, boolean> | null;
  custom_terms?: string | null;
}

async function buildRenderInput(
  admin: SupabaseClient,
  b: Bundle,
  opts: { signature: AgreementRenderInput["signature"]; overrides?: DraftOverrides | null },
): Promise<AgreementRenderInput> {
  const p = b.profile;
  const o = opts.overrides ?? null;
  const sig = b.sigRow;
  const acks = o?.acknowledgements
    ? { ...o.acknowledgements }
    : sig
    ? acknowledgementsFromSignedRecord(sig.consents)
    : {};
  const logoBytes = await loadOrgLogo(admin);
  const consents = sig?.consents ?? {};
  return {
    member: {
      name: p?.full_name || "Member",
      code: b.member.member_code,
      memberId: b.member.id,
      email: p?.email,
      phone: p?.phone,
      gender: p?.gender,
      dateOfBirth: p?.date_of_birth,
      address: p?.address,
      city: p?.city,
      state: p?.state,
      postalCode: p?.postal_code,
      emergencyContactName: p?.emergency_contact_name,
      emergencyContactPhone: p?.emergency_contact_phone,
      governmentIdType: o?.government_id_type ?? p?.government_id_type,
      governmentIdNumber: o?.government_id_number ?? p?.government_id_number,
      fitnessGoals: o?.fitness_goals ?? b.member.fitness_goals,
      healthConditions: o?.health_conditions ?? b.member.health_conditions,
    },
    membership: b.membership
      ? {
        planName: b.membership.plan_name,
        amount: b.membership.price_paid,
        startDate: b.membership.start_date,
        endDate: b.membership.end_date,
      }
      : {
        planInterest: typeof consents.pending_plan === "string" ? String(consents.pending_plan) : null,
        registeredOn: sig?.signed_at ?? b.member.joined_at,
      },
    branch: {
      name: b.branch?.name || "Incline",
      phone: b.branch?.phone,
      email: b.branch?.email,
    },
    brand: { logoBytes },
    parq: o?.par_q ?? sig?.par_q ?? null,
    acknowledgements: acks,
    customTerms: o?.custom_terms ?? sig?.custom_terms ?? null,
    signature: opts.signature,
  };
}

async function renderAndStore(
  admin: SupabaseClient,
  b: Bundle,
  reason: "sign" | "backfill" | "render_on_demand",
  actorUserId: string | null,
): Promise<{ path: string; bytes: number; hadSignature: boolean }> {
  if (!b.sigRow) throw new Error("no_signature_record");
  const sigBytes = await loadSignatureBytes(admin, b.member.id, b.sigRow);
  const input = await buildRenderInput(admin, b, {
    signature: { pngBytes: sigBytes, signedAt: b.sigRow.signed_at, ip: b.sigRow.signer_ip },
  });
  // A signed record without a recoverable signature image is still a signed
  // record — never print it as a draft. Render the typed signature line instead.
  if (!sigBytes) input.signature = { pngBytes: null, signedAt: b.sigRow.signed_at, ip: b.sigRow.signer_ip };
  const pdf = await renderMembershipAgreementPdf({ ...input, signature: input.signature, generatedAt: new Date() });

  const path = canonicalPath(b.member.id);
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`pdf_upload_failed: ${upErr.message}`);

  const prev = (b.sigRow.consents ?? {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const consents: Record<string, unknown> = {
    ...prev,
    pdf_bucket: BUCKET,
    agreement_rendered_at: nowIso,
    agreement_renderer: RENDERER,
  };
  if (reason !== "sign") {
    if (b.sigRow.terms_version && b.sigRow.terms_version !== AGREEMENT_VERSION && !prev.legacy_terms_version) {
      consents.legacy_terms_version = b.sigRow.terms_version;
    }
    if (b.sigRow.waiver_pdf_path && b.sigRow.waiver_pdf_path !== path && !prev.legacy_waiver_pdf_path) {
      consents.legacy_waiver_pdf_path = b.sigRow.waiver_pdf_path;
    }
    consents.agreement_regenerated_at = nowIso;
    consents.agreement_regenerate_reason = reason;
    if (actorUserId) consents.agreement_regenerated_by = actorUserId;
  }
  const { error: rowErr } = await admin
    .from("member_onboarding_signatures")
    .update({ waiver_pdf_path: path, terms_version: AGREEMENT_VERSION, consents })
    .eq("id", b.sigRow.id);
  if (rowErr) throw new Error(`signature_row_update_failed: ${rowErr.message}`);

  // Document vault entry — one "Membership Agreement" per member, always the canonical file.
  const fileName = agreementFilename(b.member.member_code, b.member.id);
  const { data: existingDoc } = await admin
    .from("member_documents")
    .select("id")
    .eq("member_id", b.member.id)
    .eq("document_type", "registration_form")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const docRow = { member_id: b.member.id, document_type: "registration_form", file_url: "", storage_path: path, file_name: fileName };
  if (existingDoc?.id) {
    await admin.from("member_documents").update(docRow).eq("id", existingDoc.id);
  } else {
    await admin.from("member_documents").insert({ ...docRow, uploaded_by: actorUserId });
  }

  return { path, bytes: pdf.length, hadSignature: !!sigBytes };
}

function needsRegeneration(sig: SignatureRow): boolean {
  const consents = (sig.consents ?? {}) as Record<string, unknown>;
  return (
    sig.waiver_pdf_path !== canonicalPath(sig.member_id) ||
    sig.terms_version !== AGREEMENT_VERSION ||
    consents.pdf_bucket !== BUCKET ||
    consents.agreement_renderer !== RENDERER
  );
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
async function authorizeForMember(c: CallerResult, b: Bundle, mode: "read" | "write"): Promise<boolean> {
  if (c.internal) return true;
  const isStaff = c.roles.some((r) => (STAFF_ROLES as string[]).includes(r)) || c.roles.includes("trainer");
  if (isStaff && (await canActOnBranch(c, b.member.branch_id))) return true;
  if (mode === "read" && c.roles.includes("member") && b.member.user_id && b.member.user_id === c.userId) return true;
  return false;
}

async function signedUrl(admin: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function handleGet(req: Request, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireCaller(req, corsHeaders, { roles: [...STAFF_ROLES, "trainer", "member"] });
  if (!caller.ok) return caller.response;
  const memberId = String(body.member_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json(400, { error: "invalid_member_id" });

  const b = await loadBundle(caller.admin, memberId);
  if (!b) return json(404, { error: "member_not_found" });
  if (!(await authorizeForMember(caller, b, "read"))) return json(403, { error: "forbidden" });

  const reference = agreementReference(b.member.member_code, b.member.id);
  if (!b.sigRow) {
    return json(200, { signed: false, reference, filename: agreementFilename(b.member.member_code, b.member.id) });
  }

  const path = canonicalPath(b.member.id);
  let regenerated = false;
  if (needsRegeneration(b.sigRow) || !(await objectExists(caller.admin, BUCKET, path))) {
    await renderAndStore(caller.admin, b, "render_on_demand", caller.userId);
    regenerated = true;
  }
  const url = await signedUrl(caller.admin, path);
  if (!url) return json(500, { error: "signed_url_failed" });
  return json(200, {
    signed: true,
    reference,
    path,
    bucket: BUCKET,
    signed_url: url,
    expires_in: SIGNED_URL_TTL,
    signed_at: b.sigRow.signed_at,
    terms_version: AGREEMENT_VERSION,
    filename: agreementFilename(b.member.member_code, b.member.id),
    regenerated,
  });
}

function pickOverrides(raw: unknown): DraftOverrides {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const acks: Record<string, boolean> | undefined = d.acknowledgements && typeof d.acknowledgements === "object"
    ? Object.fromEntries(
      AGREEMENT_ACKNOWLEDGEMENTS.map((a) => [a.key, (d.acknowledgements as Record<string, unknown>)[a.key] === true]),
    )
    : undefined;
  return {
    government_id_type: str(d.government_id_type, 32),
    government_id_number: str(d.government_id_number, 64),
    fitness_goals: str(d.fitness_goals, 200),
    health_conditions: str(d.health_conditions, 1000),
    par_q: d.par_q && typeof d.par_q === "object" ? normaliseParq(d.par_q as Record<string, unknown>) : undefined,
    acknowledgements: acks,
    custom_terms: str(d.custom_terms, 4000),
  };
}

async function handlePreview(req: Request, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireCaller(req, corsHeaders, { roles: STAFF_ROLES });
  if (!caller.ok) return caller.response;
  const memberId = String(body.member_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json(400, { error: "invalid_member_id" });

  const b = await loadBundle(caller.admin, memberId);
  if (!b) return json(404, { error: "member_not_found" });
  if (!(await authorizeForMember(caller, b, "write"))) return json(403, { error: "forbidden" });

  const overrides = pickOverrides(body.draft);
  const input = await buildRenderInput(caller.admin, b, { signature: null, overrides });
  const pdf = await renderMembershipAgreementPdf(input);
  return json(200, {
    draft: true,
    reference: agreementReference(b.member.member_code, b.member.id),
    filename: `DRAFT-${agreementFilename(b.member.member_code, b.member.id)}`,
    pdf_base64: bytesToBase64(pdf),
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = dataUrl.match(/^data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("invalid_signature_data_url");
  if (m[1].length > 700_000) throw new Error("signature_too_large");
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!looksLikeImage(bytes)) throw new Error("invalid_signature_image");
  return bytes;
}

async function handleSign(req: Request, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireCaller(req, corsHeaders, { roles: STAFF_ROLES });
  if (!caller.ok) return caller.response;
  const memberId = String(body.member_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) return json(400, { error: "invalid_member_id" });

  const b = await loadBundle(caller.admin, memberId);
  if (!b) return json(404, { error: "member_not_found" });
  if (!(await authorizeForMember(caller, b, "write"))) return json(403, { error: "forbidden" });

  // --- validate ------------------------------------------------------------
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = dataUrlToBytes(String(body.signature_data_url || ""));
  } catch (e) {
    return json(400, { error: (e as Error).message || "invalid_signature" });
  }
  const rawConsents = (body.consents && typeof body.consents === "object" ? body.consents : {}) as Record<string, unknown>;
  const acks: Record<string, boolean> = Object.fromEntries(
    AGREEMENT_ACKNOWLEDGEMENTS.map((a) => [a.key, rawConsents[a.key] === true]),
  );
  const missing = REQUIRED_ACKNOWLEDGEMENT_KEYS.filter((k) => acks[k] !== true);
  if (missing.length) return json(400, { error: "required_consents_missing", missing });

  const overrides = pickOverrides(body);
  const parq = normaliseParq((body.par_q && typeof body.par_q === "object" ? body.par_q : {}) as Record<string, unknown>);
  const customTerms = overrides.custom_terms?.trim() ? overrides.custom_terms.trim() : null;

  // --- persist member edits (same fields the drawer collects) -------------
  const memberUpdates: Record<string, string> = {};
  if (overrides.fitness_goals !== undefined && overrides.fitness_goals !== (b.member.fitness_goals ?? "")) {
    memberUpdates.fitness_goals = overrides.fitness_goals ?? "";
  }
  if (overrides.health_conditions !== undefined && overrides.health_conditions !== (b.member.health_conditions ?? "")) {
    memberUpdates.health_conditions = overrides.health_conditions ?? "";
  }
  if (Object.keys(memberUpdates).length) {
    const { error } = await caller.admin.from("members").update(memberUpdates).eq("id", memberId);
    if (error) await captureEdgeError(FN, error, { route: "sign_member_update", member_id: memberId });
  }
  if (b.member.user_id) {
    const profileUpdates: Record<string, string> = {};
    if (overrides.government_id_type && overrides.government_id_type !== (b.profile?.government_id_type ?? "")) {
      profileUpdates.government_id_type = overrides.government_id_type;
    }
    if (overrides.government_id_number && overrides.government_id_number !== (b.profile?.government_id_number ?? "")) {
      profileUpdates.government_id_number = overrides.government_id_number;
    }
    if (Object.keys(profileUpdates).length) {
      const { error } = await caller.admin.from("profiles").update(profileUpdates).eq("id", b.member.user_id);
      if (error) await captureEdgeError(FN, error, { route: "sign_profile_update", member_id: memberId });
    }
  }

  // --- signature image + legal record --------------------------------------
  const signedAt = new Date().toISOString();
  const sigPath = `${memberId}/signature.png`;
  const { error: sigUpErr } = await caller.admin.storage
    .from(BUCKET)
    .upload(sigPath, signatureBytes, { contentType: "image/png", upsert: true });
  if (sigUpErr) {
    await captureEdgeError(FN, sigUpErr, { route: "sign_sig_upload", member_id: memberId });
    return json(500, { error: "signature_upload_failed" });
  }

  const { data: row, error: rowErr } = await caller.admin
    .from("member_onboarding_signatures")
    .insert({
      member_id: memberId,
      signature_path: sigPath,
      waiver_pdf_path: canonicalPath(memberId),
      par_q: parq,
      consents: {
        ...acks,
        source: "staff_registration_form",
        pdf_bucket: BUCKET,
        signed_with_staff_user_id: caller.userId,
      },
      custom_terms: customTerms,
      terms_version: AGREEMENT_VERSION,
      signer_ip: clientIp(req),
      signer_user_agent: req.headers.get("user-agent"),
      signed_at: signedAt,
    })
    .select("id")
    .single();
  if (rowErr || !row) {
    await captureEdgeError(FN, rowErr, { route: "sign_row_insert", member_id: memberId });
    return json(500, { error: "signature_record_failed" });
  }

  // --- render + store the ONE document --------------------------------------
  const fresh = await loadBundle(caller.admin, memberId);
  if (!fresh?.sigRow) return json(500, { error: "reload_failed" });
  try {
    await renderAndStore(caller.admin, fresh, "sign", caller.userId);
  } catch (e) {
    await captureEdgeError(FN, e, { route: "sign_render", member_id: memberId });
    return json(500, { error: "agreement_render_failed", detail: (e as Error).message });
  }
  const path = canonicalPath(memberId);
  return json(200, {
    ok: true,
    reference: agreementReference(fresh.member.member_code, memberId),
    path,
    bucket: BUCKET,
    signed_at: signedAt,
    signed_url: await signedUrl(caller.admin, path),
    filename: agreementFilename(fresh.member.member_code, memberId),
  });
}

async function handleBackfill(req: Request, body: Record<string, unknown>): Promise<Response> {
  const caller = await requireCaller(req, corsHeaders, { roles: ["owner", "admin"] });
  if (!caller.ok) return caller.response;
  const limit = Math.min(Math.max(Number(body.limit) || 15, 1), 40);
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const onlyIds = Array.isArray(body.member_ids)
    ? (body.member_ids as unknown[]).map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    : null;

  // Latest signature row per member.
  const { data: rows, error } = await caller.admin
    .from("member_onboarding_signatures")
    .select("id, member_id, signature_path, waiver_pdf_path, par_q, consents, custom_terms, terms_version, signer_ip, signed_at")
    .order("signed_at", { ascending: false });
  if (error) return json(500, { error: "scan_failed", detail: error.message });
  const latest = new Map<string, SignatureRow>();
  for (const r of (rows ?? []) as SignatureRow[]) if (!latest.has(r.member_id)) latest.set(r.member_id, r);

  const pending = [...latest.values()].filter((r) =>
    (onlyIds ? onlyIds.includes(r.member_id) : true) && (force || needsRegeneration(r))
  );
  const batch = pending.slice(0, limit);
  const results: Array<Record<string, unknown>> = [];
  if (!dryRun) {
    for (const r of batch) {
      try {
        const b = await loadBundle(caller.admin, r.member_id);
        if (!b || !b.sigRow) { results.push({ member_id: r.member_id, status: "skipped", reason: "member_missing" }); continue; }
        const out = await renderAndStore(caller.admin, b, "backfill", caller.userId);
        results.push({ member_id: r.member_id, code: b.member.member_code, status: "done", bytes: out.bytes, signature: out.hadSignature });
      } catch (e) {
        await captureEdgeError(FN, e, { route: "backfill_member", member_id: r.member_id });
        results.push({ member_id: r.member_id, status: "error", error: (e as Error).message });
      }
    }
  }
  return json(200, {
    total_members: latest.size,
    pending_before: pending.length,
    processed: dryRun ? 0 : results.length,
    remaining: Math.max(0, pending.length - (dryRun ? 0 : results.filter((r) => r.status === "done").length)),
    dry_run: dryRun,
    results: dryRun ? batch.map((r) => ({ member_id: r.member_id, terms_version: r.terms_version, waiver_pdf_path: r.waiver_pdf_path })) : results,
  });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const action = String(body.action || "");
  try {
    switch (action) {
      case "get": return await handleGet(req, body);
      case "preview": return await handlePreview(req, body);
      case "sign": return await handleSign(req, body);
      case "backfill": return await handleBackfill(req, body);
      default: return json(400, { error: "unknown_action" });
    }
  } catch (e) {
    await captureEdgeError(FN, e, { route: action || "unknown" });
    return json(500, { error: "internal_error", detail: (e as Error)?.message ?? String(e) });
  }
});

// Keep the type import referenced for editors that tree-shake unused imports.
export type { SupabaseClient };
void createClient;
