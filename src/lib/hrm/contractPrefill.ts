// Pure resolver that derives contract-variable defaults from existing
// employee / trainer / profile rows. Used by:
//   • CreateContractDrawer  → seed the "Contract Variables" form
//   • contract-signing edge → fill missing fields server-side at sign/PDF time
//
// Keep this file dependency-free so the same logic can be inlined on the edge.

export type ContractPrefillSources = {
  employee?: {
    father_or_spouse_name?: string | null;
    current_address?: unknown;       // jsonb
    permanent_address?: unknown;     // jsonb
    emergency_contact?: unknown;     // jsonb { name, phone, relation }
    pan_number?: string | null;
    aadhaar_last4?: string | null;
  } | null;
  trainer?: {
    government_id_type?: string | null;
    government_id_number?: string | null;
  } | null;
  profile?: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postal_code?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    government_id_type?: string | null;
    government_id_number?: string | null;
  } | null;
};

export type ContractPrefillValue = { value: string; source: 'employee' | 'trainer' | 'profile' };
export type ContractPrefillMap = Partial<Record<
  | 'father_or_husband_name'
  | 'residential_address'
  | 'emergency_contact_name'
  | 'emergency_contact_phone'
  | 'pan_or_aadhaar_last4'
  | 'government_id_type',
  ContractPrefillValue
>>;

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function flattenAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = [a.line1, a.line2, a.street, a.area, a.city, a.state, a.country, a.pin || a.postal_code || a.pincode]
    .map((p) => nonEmpty(p)).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function last4(v: unknown): string | null {
  const s = nonEmpty(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function resolveContractPrefill(src: ContractPrefillSources): ContractPrefillMap {
  const out: ContractPrefillMap = {};
  const { employee, trainer, profile } = src;

  // Father / spouse name — only on employees row today
  const father = nonEmpty(employee?.father_or_spouse_name);
  if (father) out.father_or_husband_name = { value: father, source: 'employee' };

  // Residential address — employees.current_address → profiles.address
  const empAddr = flattenAddress(employee?.current_address) || flattenAddress(employee?.permanent_address);
  if (empAddr) {
    out.residential_address = { value: empAddr, source: 'employee' };
  } else if (profile) {
    const profAddr = [profile.address, profile.city, profile.state, profile.country, profile.postal_code]
      .map(nonEmpty).filter(Boolean).join(', ');
    if (profAddr) out.residential_address = { value: profAddr, source: 'profile' };
  }

  // Emergency contact — employees.emergency_contact jsonb → profiles
  const ec = employee?.emergency_contact as Record<string, unknown> | undefined | null;
  const ecName = nonEmpty(ec?.name) || nonEmpty(profile?.emergency_contact_name);
  const ecPhone = nonEmpty(ec?.phone) || nonEmpty(profile?.emergency_contact_phone);
  if (ecName) out.emergency_contact_name = { value: ecName, source: nonEmpty(ec?.name) ? 'employee' : 'profile' };
  if (ecPhone) out.emergency_contact_phone = { value: ecPhone, source: nonEmpty(ec?.phone) ? 'employee' : 'profile' };

  // PAN / Aadhaar last 4
  const panLast4 = last4(employee?.pan_number);
  const aadhaarLast4 = nonEmpty(employee?.aadhaar_last4) || last4(profile?.government_id_number) || last4(trainer?.government_id_number);
  const idLast4 = panLast4 || aadhaarLast4;
  if (idLast4) out.pan_or_aadhaar_last4 = { value: idLast4, source: panLast4 ? 'employee' : (employee?.aadhaar_last4 ? 'employee' : (profile?.government_id_number ? 'profile' : 'trainer')) };

  // Government ID type (for display)
  const gidType = nonEmpty(profile?.government_id_type) || nonEmpty(trainer?.government_id_type);
  if (gidType) out.government_id_type = { value: gidType, source: nonEmpty(profile?.government_id_type) ? 'profile' : 'trainer' };

  return out;
}

/** Flatten the prefill map → plain key/value record for merging with contract_variables. */
export function prefillToVariables(p: ContractPrefillMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, entry] of Object.entries(p)) {
    if (entry && entry.value) out[k] = entry.value;
  }
  return out;
}
