import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

export type ReferralState = { code: string; valid: boolean };

interface Props {
  branchId?: string;
  phone?: string;
  email?: string;
  initialCode?: string;
  inputClassName?: string;
  onChange: (s: ReferralState) => void;
}

const REASON_COPY: Record<string, string> = {
  invalid: "This code isn't valid for this branch.",
  rate_limited: "Too many tries. Please wait 15 minutes, or continue without a code.",
  disabled: "Referrals aren't available right now.",
};

/** Shown on /register only when the chosen branch has referrals switched on. */
export function ReferralCodeField({ branchId, phone, email, initialCode = "", inputClassName, onChange }: Props) {
  const id = useId();
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, 32));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: enabled } = useQuery({
    queryKey: ["referral-enabled", branchId],
    enabled: !!branchId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_referral_enabled", { p_branch_id: branchId! });
      if (error) return false;
      return data === true;
    },
  });

  useEffect(() => {
    if (!enabled) onChange({ code: "", valid: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!branchId || !enabled) return null;

  const validate = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc("validate_referral_code", {
        p_code: c, p_branch_id: branchId, p_phone: phone || null, p_email: email || null,
      });
      const r = (data ?? {}) as { valid?: boolean; referrer_display?: string; reason?: string };
      if (error || !r.valid) {
        setResult({ ok: false, text: REASON_COPY[r.reason ?? "invalid"] ?? REASON_COPY.invalid });
        onChange({ code: "", valid: false });
      } else {
        setResult({ ok: true, text: `Valid code — referred by ${r.referrer_display}.` });
        onChange({ code: c, valid: true });
      }
    } finally {
      setBusy(false);
    }
  };

  const msgId = `${id}-msg`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-primary-foreground/80">
        Referral code (optional)
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={code}
          maxLength={32}
          autoComplete="off"
          aria-describedby={result ? msgId : undefined}
          aria-invalid={result ? !result.ok : undefined}
          className={inputClassName}
          placeholder="e.g. INC-26-0014"
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setResult(null);
            onChange({ code: "", valid: false });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void validate(); }
          }}
        />
        <button
          type="button"
          onClick={validate}
          disabled={busy || !code.trim()}
          className="min-h-11 min-w-[96px] rounded-xl border border-primary/50 bg-primary/15 px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-label="Checking" /> : "Validate"}
        </button>
      </div>
      <p id={msgId} role="status" aria-live="polite" className="min-h-[1rem] text-xs">
        {result && (
          <span className={`inline-flex items-center gap-1.5 ${result.ok ? "text-emerald-400" : "text-destructive"}`}>
            {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertCircle className="h-3.5 w-3.5" aria-hidden />}
            {result.text}
          </span>
        )}
      </p>
      <p className="text-[11px] text-primary-foreground/50">Leave blank if no one referred you. Sign-up works either way.</p>
    </div>
  );
}
