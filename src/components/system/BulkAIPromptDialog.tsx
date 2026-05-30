import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export interface ErrorRow {
  id: string;
  error_message: string;
  stack_trace?: string | null;
  function_name?: string | null;
  route?: string | null;
  source?: string | null;
  severity?: string | null;
  fingerprint?: string | null;
  occurrence_count?: number | null;
  last_seen?: string | null;
  context?: any;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  errors: ErrorRow[];
  groupedBy?: 'fingerprint' | 'selection';
}

function buildGroupPrompt(errors: ErrorRow[], groupedBy: 'fingerprint' | 'selection') {
  const total = errors.reduce((s, e) => s + (e.occurrence_count ?? 1), 0);
  const groups = new Map<string, ErrorRow[]>();
  for (const e of errors) {
    const key = e.fingerprint || `${e.source}|${e.function_name || e.route || ''}|${(e.error_message || '').slice(0, 80)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const header = groupedBy === 'fingerprint'
    ? `I have ${groups.size} distinct error cluster(s) (${total} total occurrences) in my Incline gym SaaS. Please audit each one, identify root causes, and provide a single consolidated fix plan. Group by file and prioritize by severity + occurrence count.`
    : `I have ${errors.length} related errors (${total} total occurrences) selected from System Health. Please audit them together — they may share a root cause — and provide one fix plan.`;

  const blocks: string[] = [];
  let i = 0;
  for (const [key, rows] of groups) {
    i += 1;
    const head = rows[0];
    const occ = rows.reduce((s, e) => s + (e.occurrence_count ?? 1), 0);
    blocks.push(
      [
        `--- Cluster ${i} (${occ} occurrences) ---`,
        `Source: ${head.source || 'frontend'}`,
        `Severity: ${head.severity || 'error'}`,
        `Function/Route: ${head.function_name || head.route || '—'}`,
        `Fingerprint: ${head.fingerprint || key.slice(0, 16)}`,
        `Last seen: ${head.last_seen || 'n/a'}`,
        `Message: ${head.error_message}`,
        head.stack_trace ? `Top stack frame: ${(head.stack_trace.split('\n')[0] || '').slice(0, 240)}` : '',
        head.context ? `Context: ${JSON.stringify(head.context).slice(0, 400)}` : '',
      ].filter(Boolean).join('\n'),
    );
  }

  return `${header}\n\n${blocks.join('\n\n')}\n\nFor each cluster, list: (1) most likely root cause, (2) exact file(s) to edit, (3) the minimal code fix. If two clusters share a cause, say so and give one fix.`;
}

export function BulkAIPromptDialog({ open, onOpenChange, errors, groupedBy = 'selection' }: Props) {
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
            <Sparkles className="h-5 w-5 text-indigo-600" />
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
