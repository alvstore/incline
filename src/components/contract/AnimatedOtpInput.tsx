import { useContext } from 'react';
import { OTPInput, OTPInputContext } from 'input-otp';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  /** Changes on every new error to replay the shake. */
  errorKey?: string | number | null;
  disabled?: boolean;
  id?: string;
}

function Slot({ index, error }: { index: number; error?: boolean }) {
  const ctx = useContext(OTPInputContext);
  const reduce = useReducedMotion();
  const { char, isActive, hasFakeCaret } = ctx.slots[index];
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: isActive && !reduce ? 1.06 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26, delay: reduce ? 0 : index * 0.04 }}
      className={cn(
        'relative flex aspect-[4/5] w-full max-w-[52px] min-w-0 items-center justify-center rounded-xl border-2 bg-card text-xl font-semibold tabular-nums transition-colors sm:text-2xl',
        error ? 'border-destructive text-destructive' : char ? 'border-primary/60' : 'border-border',
        isActive && !error && 'border-primary ring-4 ring-primary/15',
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {char && (
          <motion.span
            key={char + index}
            initial={reduce ? false : { y: 14, opacity: 0, scale: 0.6 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { y: -10, opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
          >
            {char}
          </motion.span>
        )}
      </AnimatePresence>
      {hasFakeCaret && (
        <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-6 w-0.5 animate-pulse rounded bg-primary" />
        </span>
      )}
    </motion.div>
  );
}

export function AnimatedOtpInput({ value, onChange, error, errorKey, disabled, id }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={error && !reduce ? `err-${errorKey}` : 'ok'}
      animate={error && !reduce ? { x: [0, -10, 10, -7, 7, -3, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
      className="w-full"
    >
      <OTPInput
        id={id}
        maxLength={6}
        value={value}
        onChange={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="^\d*$"
        disabled={disabled}
        aria-label="6-digit verification code"
        aria-invalid={error || undefined}
        containerClassName="flex w-full items-center justify-between gap-1.5 sm:justify-start sm:gap-2.5 has-[:disabled]:opacity-50"
        render={() => (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <Slot key={i} index={i} error={error} />
            ))}
          </>
        )}
      />
    </motion.div>
  );
}
