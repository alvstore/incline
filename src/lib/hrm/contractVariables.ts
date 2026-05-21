// Canonical registry of "contract variables" — the *only* fields the drawer
// asks for. Everything else is rendered server-side from the employer profile,
// employee profile, trainer profile, hr_settings or the contract template.
//
// Used by:
//   • CreateContractDrawer  → "Missing Fields" collector
//   • ContractFill          → public role-scoped fill page
//   • contract-signing edge → per-role allowlist when persisting fields
//   • PDF builder           → variable interpolation

export type FillRole = 'employee' | 'witness_1' | 'witness_2' | 'hr';

export type ContractVariableKey =
  // Employee-fillable
  | 'father_or_husband_name'
  | 'residential_address'
  | 'emergency_contact_name'
  | 'emergency_contact_phone'
  | 'pan_or_aadhaar_last4'
  // HR-fillable
  | 'probation_months'
  | 'notice_period_days'
  // Witness-fillable
  | 'witness_1_name'
  | 'witness_1_phone'
  | 'witness_2_name'
  | 'witness_2_phone';

export interface VariableSpec {
  key: ContractVariableKey;
  label: string;
  role: FillRole;
  required: boolean;          // required *before* the contract can be signed
  placeholder?: string;
  helper?: string;
  input?: 'text' | 'tel' | 'number' | 'textarea';
}

export const CONTRACT_VARIABLES: VariableSpec[] = [
  { key: 'father_or_husband_name', role: 'employee', required: true,  label: "Father's or Husband's name (S/o, D/o)", placeholder: 'Full name', input: 'text' },
  { key: 'residential_address',    role: 'employee', required: true,  label: 'Residential address',                    placeholder: 'House/Street, City, State, PIN', input: 'textarea' },
  { key: 'emergency_contact_name', role: 'employee', required: true,  label: 'Emergency contact — Name',               placeholder: 'Full name', input: 'text' },
  { key: 'emergency_contact_phone',role: 'employee', required: true,  label: 'Emergency contact — Phone',              placeholder: '+91…', input: 'tel' },
  { key: 'pan_or_aadhaar_last4',   role: 'employee', required: false, label: 'PAN or Aadhaar (last 4 digits)',         placeholder: '1234', input: 'text', helper: 'For identification only — full ID stored separately under document vault.' },

  { key: 'probation_months',       role: 'hr',       required: false, label: 'Probation period (months)',              placeholder: '3', input: 'number' },
  { key: 'notice_period_days',     role: 'hr',       required: false, label: 'Notice period (days)',                   placeholder: '30', input: 'number', helper: 'Defaults to HR Settings notice period for this role.' },

  { key: 'witness_1_name',  role: 'witness_1', required: true,  label: 'Witness 1 — Name',  input: 'text' },
  { key: 'witness_1_phone', role: 'witness_1', required: false, label: 'Witness 1 — Phone', input: 'tel' },
  { key: 'witness_2_name',  role: 'witness_2', required: true,  label: 'Witness 2 — Name',  input: 'text' },
  { key: 'witness_2_phone', role: 'witness_2', required: false, label: 'Witness 2 — Phone', input: 'tel' },
];

export function variablesFor(role: FillRole): VariableSpec[] {
  if (role === 'hr') {
    // HR can also pre-fill witnesses on the manager-side drawer
    return CONTRACT_VARIABLES.filter((v) => v.role === 'hr' || v.role === 'witness_1' || v.role === 'witness_2');
  }
  return CONTRACT_VARIABLES.filter((v) => v.role === role);
}

export function allowlistFor(role: FillRole): ContractVariableKey[] {
  return variablesFor(role).map((v) => v.key);
}

export function requiredBeforeSign(): ContractVariableKey[] {
  return CONTRACT_VARIABLES.filter((v) => v.required).map((v) => v.key);
}

export function missingRequiredKeys(vars: Record<string, unknown> | null | undefined): ContractVariableKey[] {
  const v = vars ?? {};
  return requiredBeforeSign().filter((k) => {
    const val = (v as any)[k];
    return val === undefined || val === null || String(val).trim() === '';
  });
}

export function isComplete(vars: Record<string, unknown> | null | undefined): boolean {
  return missingRequiredKeys(vars).length === 0;
}
