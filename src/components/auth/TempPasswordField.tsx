import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

export const DEFAULT_TEMP_PASSWORD = 'Incline@123';

/**
 * @deprecated Kept for backwards compatibility. New users get the fixed
 * default password `Incline@123` and must change it on first login.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function generateTempPassword(): string {
  return DEFAULT_TEMP_PASSWORD;
}

interface DefaultPasswordCardProps {
  label?: string;
}

/**
 * Static info card shown on all "Create User" drawers.
 * The system uses a fixed default password (`Incline@123`) for every new
 * member / trainer / staff / manager. They are forced to change it on first
 * login via the `must_set_password` flag.
 */
export function DefaultPasswordCard({ label = 'Default Login Password' }: DefaultPasswordCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(DEFAULT_TEMP_PASSWORD);
    setCopied(true);
    toast.success('Password copied');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 flex items-center gap-3">
      <div className="bg-indigo-100 text-indigo-600 p-2 rounded-full">
        <KeyRound className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="font-mono text-sm font-bold text-slate-900">{DEFAULT_TEMP_PASSWORD}</p>
        <p className="text-xs text-slate-500">User must change this on first login.</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="shrink-0"
        aria-label="Copy default password"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

// Backwards-compatible export — old `TempPasswordField` callers now render
// the static default password card instead of a custom input.
export function TempPasswordField(_props: { value?: string; onChange?: (v: string) => void; label?: string; helperText?: string }) {
  return <DefaultPasswordCard label={_props.label} />;
}
