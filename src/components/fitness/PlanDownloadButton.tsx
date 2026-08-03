import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadPlanPdf } from '@/utils/pdfBlob';

interface PlanDownloadButtonProps {
  /** Stored file, when the plan was delivered as an uploaded PDF. */
  pdfUrl?: string | null;
  pdfFilename?: string | null;
  /** Structured plan content, used to generate a PDF on demand. */
  planName: string;
  planType: 'workout' | 'diet';
  planData: any;
  description?: string | null;
  caloriesTarget?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  memberName?: string | null;
  memberCode?: string | null;
  trainerName?: string | null;
  goal?: string | null;
  branchId?: string | null;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
}

/**
 * Download action for member-facing plans: serves the stored PDF when one
 * exists, otherwise builds it on demand from the structured plan content
 * using the same generator the staff side uses.
 */
export function PlanDownloadButton({
  pdfUrl,
  pdfFilename,
  planName,
  planType,
  planData,
  description,
  caloriesTarget,
  validFrom,
  validUntil,
  memberName,
  memberCode,
  trainerName,
  goal,
  branchId,
  size = 'sm',
  variant = 'outline',
  className,
}: PlanDownloadButtonProps) {
  const [busy, setBusy] = useState(false);

  const hasContent = !!planData && (Array.isArray(planData?.weeks) || Array.isArray(planData?.days) || Array.isArray(planData?.meals));
  if (!pdfUrl && !hasContent) return null;

  const handleDownload = async () => {
    if (pdfUrl) {
      window.open(pdfUrl, '_blank', 'noopener');
      return;
    }
    setBusy(true);
    try {
      await downloadPlanPdf({
        name: planName,
        type: planType,
        description: description ?? null,
        caloriesTarget: caloriesTarget ?? null,
        validFrom: validFrom ?? null,
        validUntil: validUntil ?? null,
        data: planData,
        member_name: memberName ?? null,
        member_code: memberCode ?? null,
        trainer_name: trainerName ?? null,
        goal: goal ?? null,
        branch_id: branchId ?? null,
      });
    } catch (err) {
      console.error('Plan PDF download failed:', err);
      toast.error('Could not prepare the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={handleDownload}
      disabled={busy}
      aria-label={`Download ${planType} plan PDF`}
    >
      {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
      {busy ? 'Preparing…' : pdfFilename ? 'Download' : 'Download PDF'}
    </Button>
  );
}
