import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/**
 * Canonical opt-in copy. Persisted verbatim into `comm_consent_text` for
 * DLT / MSG91 / TRAI / RCS audit evidence. Do NOT paraphrase per surface —
 * the audit log relies on the exact string the user saw.
 */
export const COMM_CONSENT_TEXT =
  'I authorise The Incline Life by Incline to send me notifications via SMS, Email, RCS and WhatsApp as per the Terms of Service and Privacy Policy.';

export const COMM_CONSENT_CHANNELS = ['sms', 'email', 'rcs', 'whatsapp'] as const;
export type CommConsentChannel = (typeof COMM_CONSENT_CHANNELS)[number];

export interface ConsentPayload {
  granted: boolean;
  channels: string[];
  text: string;
}

export function buildConsentPayload(granted: boolean): ConsentPayload {
  return {
    granted,
    channels: granted ? [...COMM_CONSENT_CHANNELS] : [],
    text: COMM_CONSENT_TEXT,
  };
}

interface CommConsentCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  className?: string;
  /** Dark-glass surfaces (PublicRegistration) → light text. */
  tone?: 'default' | 'dark';
  required?: boolean;
}

export function CommConsentCheckbox({
  checked,
  onCheckedChange,
  id = 'comm-consent',
  className,
  tone = 'default',
  required,
}: CommConsentCheckboxProps) {
  const labelCls =
    tone === 'dark'
      ? 'text-sm text-white/80 leading-relaxed cursor-pointer'
      : 'text-sm text-slate-600 leading-relaxed cursor-pointer';
  const linkCls =
    tone === 'dark'
      ? 'text-primary hover:underline'
      : 'text-indigo-600 hover:underline';

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-describedby={`${id}-desc`}
        aria-required={required}
        className="mt-0.5"
      />
      <label htmlFor={id} id={`${id}-desc`} className={labelCls}>
        I authorise <span className="font-medium">The Incline Life by Incline</span> to send me
        notifications via SMS, Email, RCS and WhatsApp as per the{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer" className={linkCls}>
          Terms of Service
        </a>{' '}
        /{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className={linkCls}>
          Privacy Policy
        </a>
        {required ? <span className="text-destructive ml-0.5">*</span> : null}.
      </label>
    </div>
  );
}
