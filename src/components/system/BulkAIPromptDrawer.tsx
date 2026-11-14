import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { buildGroupPrompt, type PromptErrorRow } from '@/lib/system/aiFixPrompt';

export type ErrorRow = PromptErrorRow;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  errors: ErrorRow[];
  groupedBy?: 'fingerprint' | 'selection';
}

export function BulkAIPromptDrawer({ open, onOpenChange, errors, groupedBy = 'selection' }: Props) {
  const prompt = useMemo(() => (errors.length ? buildGroupPrompt(errors, groupedBy) : ''), [errors, groupedBy]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    toast.success('Group prompt copied');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Group AI Fix Prompt — {errors.length} error{errors.length === 1 ? '' : 's'}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Paste this prompt into Lovable to fix all selected errors in one pass.
          </p>
          <Textarea value={prompt} readOnly className="min-h-[400px] text-xs font-mono" />
          <Button onClick={copy} className="gap-2">
            <Copy className="h-4 w-4" /> {copied ? 'Copied!' : 'Copy prompt'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
