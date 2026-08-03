import { useEffect, useRef, useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { LiquidButton } from "@/components/ui/liquid-button";
import { Loader2, ArrowRight, RefreshCw, PenLine, AlertCircle } from "lucide-react";

const RESEND_COOLDOWN_SEC = 30;
const CODE_TTL_SEC = 300;

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface OtpStepProps {
  phone: string;
  email?: string | null;
  /** ms timestamp of the last successful OTP send — resets both timers */
  sentAt: number;
  /** ms timestamp until which resend is locked (server rate-limit), 0 when free */
  lockedUntil?: number;
  otp: string;
  onOtpChange: (v: string) => void;
  onVerify: () => void;
  onResend: () => void;
  verifying: boolean;
  /** staged status copy shown while verifying */
  verifyStage?: string;
  resending: boolean;
  errorMessage?: string | null;
  onChangeNumber: () => void;
}

export function OtpStep({
  phone,
  email,
  sentAt,
  lockedUntil = 0,
  otp,
  onOtpChange,
  onVerify,
  onResend,
  verifying,
  verifyStage,
  resending,
  errorMessage,
  onChangeNumber,
}: OtpStepProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = Math.floor((now - sentAt) / 1000);
  const resendIn = Math.max(0, RESEND_COOLDOWN_SEC - elapsed);
  const lockedFor = Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const expiresIn = Math.max(0, CODE_TTL_SEC - elapsed);
  const expired = expiresIn === 0;
  const canResend = !resending && resendIn === 0 && lockedFor === 0;

  // Auto-submit once six digits are present (one attempt per code entry).
  const autoTried = useRef<string>("");
  useEffect(() => {
    if (otp.length === 6 && !verifying && !expired && autoTried.current !== otp) {
      autoTried.current = otp;
      onVerify();
    }
  }, [otp, verifying, expired, onVerify]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-primary-foreground/70">
          We sent a 6-digit code to{" "}
          <span className="font-semibold text-primary-foreground">{phone}</span> on WhatsApp
          {email ? " & email" : ""}.
        </p>
        <button
          type="button"
          onClick={onChangeNumber}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
        >
          <PenLine className="h-3 w-3" /> Wrong number? Change it
        </button>
      </div>

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={otp}
          onChange={onOtpChange}
          autoFocus
          disabled={verifying}
          inputMode="numeric"
          autoComplete="one-time-code"
          containerClassName="has-[:disabled]:opacity-60"
        >
          <InputOTPGroup className="gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="h-14 w-12 rounded-xl border-2 border-primary-foreground/15 bg-card/5 text-xl font-bold text-primary-foreground shadow-sm transition-all data-[active=true]:border-primary data-[active=true]:ring-2 data-[active=true]:ring-primary/30"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      <p className="text-center text-xs text-primary-foreground/55" aria-live="polite">
        {expired ? "Your code has expired — tap Resend below." : `Code expires in ${mmss(expiresIn)}`}
      </p>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <LiquidButton
        type="button"
        size="lg"
        className="w-full"
        disabled={otp.length !== 6 || verifying || expired}
        onClick={onVerify}
      >
        {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
        {verifying ? verifyStage || "Verifying..." : "Verify & complete"}
        {!verifying && <ArrowRight className="h-4 w-4" />}
      </LiquidButton>

      <button
        type="button"
        className="mx-auto flex items-center justify-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:text-primary-foreground/40"
        onClick={onResend}
        disabled={!canResend}
      >
        {resending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...
          </>
        ) : lockedFor > 0 ? (
          `Too many requests — retry in ${mmss(lockedFor)}`
        ) : resendIn > 0 ? (
          `Resend in ${mmss(resendIn)}`
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" /> Resend code
          </>
        )}
      </button>
    </div>
  );
}
