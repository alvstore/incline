import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  attendanceRecorded: boolean;
  manualOverride?: boolean;
}

/**
 * Inline single-line chip for the Payroll "Days" column.
 * Replaces the wrapping amber blob with a Vuexy-density pill + lucide icon.
 */
export function AttendanceStateBadge({ attendanceRecorded, manualOverride }: Props) {
  if (attendanceRecorded) return null;

  if (manualOverride) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
              <CheckCircle2 className="h-3 w-3" />
              Manually marked
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            HR marked this month as fully present. Net pay is calculated on the synthetic attendance.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
            <AlertTriangle className="h-3 w-3" />
            No attendance
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          No check-ins recorded for this period. Sync MIPS attendance or use "Mark full month present" before processing payroll.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
