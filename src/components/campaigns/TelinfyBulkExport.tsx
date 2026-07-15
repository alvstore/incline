import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { ResolvedRecipient } from '@/services/campaignService';

/**
 * Telinfy bulk-upload format:
 *   CountryCode | MSISDN | <var1> | <var2> | ...
 *   91          | 9887601200 | Rahul  | ...
 * Country code is separate from MSISDN (digits only, no '+').
 * Extra columns are per-template variables (`lcustomParam` keys).
 */
export interface TelinfyBulkExportProps {
  campaignName: string;
  recipients: ResolvedRecipient[];
  /** Variable keys as they appear in the Telinfy template body ({{CUSTOM_PARAM1}} → 'CUSTOM_PARAM1'). */
  variableKeys: string[];
  /**
   * Optional per-recipient variable resolver. Defaults to first_name for the
   * first key, empty for the rest — matches how the CRM auto-fills RCS sends.
   */
  resolveVar?: (r: ResolvedRecipient, key: string, index: number) => string;
}

function splitName(full?: string | null): { first: string; last: string } {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function defaultResolve(r: ResolvedRecipient, key: string, index: number): string {
  // Tolerate alt shapes coming from RPCs / CSV imports (name, first_name, last_name).
  const anyR = r as any;
  const fullRaw = (r.full_name || anyR.name || [anyR.first_name, anyR.last_name].filter(Boolean).join(' ') || '').trim();
  const { first, last } = splitName(fullRaw);
  const k = key.toLowerCase();
  if (k === 'last_name' || /last|surname|family/i.test(k)) return last || '';
  if (k === 'first_name' || /first/i.test(k)) return first || 'there';
  if (k === 'email' || /email|mail/i.test(k)) return r.email || '';
  // Default (full_name, name, CUSTOM_PARAM1, first column, …): send the full name.
  if (k === 'full_name' || /full|name/i.test(k) || index === 0) return fullRaw || first || 'there';
  return '';
}

function csvEscape(v: string) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitCountry(phone: string): { cc: string; msisdn: string } {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { cc: '91', msisdn: '' };
  // Default to +91 (India) — matches PhoneInput convention across the app.
  if (digits.length === 10) return { cc: '91', msisdn: digits };
  if (digits.startsWith('91') && digits.length === 12) return { cc: '91', msisdn: digits.slice(2) };
  // Fallback: assume last 10 digits are MSISDN and the prefix is the country code.
  return { cc: digits.slice(0, digits.length - 10) || '91', msisdn: digits.slice(-10) };
}

export function buildTelinfyCsv(props: TelinfyBulkExportProps): string {
  const { recipients, variableKeys, resolveVar = defaultResolve } = props;
  const header = ['CountryCode', 'MSISDN', ...variableKeys].map(csvEscape).join(',');
  const rows = recipients
    .filter((r) => !!r.phone)
    .map((r) => {
      const { cc, msisdn } = splitCountry(r.phone!);
      const vars = variableKeys.map((k, i) => csvEscape(resolveVar(r, k, i)));
      return [cc, msisdn, ...vars].join(',');
    });
  return [header, ...rows].join('\n');
}

export function TelinfyBulkExportButton(props: TelinfyBulkExportProps & { disabled?: boolean }) {
  const { campaignName, recipients, variableKeys, disabled, resolveVar } = props;
  const onClick = () => {
    if (!recipients.length) { toast.error('Audience is empty'); return; }
    const csv = buildTelinfyCsv({ campaignName, recipients, variableKeys, resolveVar });
    const safe = (campaignName || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telinfy_${safe}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${recipients.filter((r) => r.phone).length} rows for Telinfy bulk upload`);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled || !recipients.length}
      className="rounded-full h-8 px-3 text-xs gap-1.5"
      title="Download a Telinfy-format CSV (CountryCode, MSISDN, template variables) for emergency manual upload"
    >
      <Download className="h-3.5 w-3.5" /> Telinfy bulk CSV
    </Button>
  );
}
