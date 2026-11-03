import { useMemo } from 'react';
import { Copy, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { toDlt, toSmartpingRow, cleanDltSpaces } from '@/lib/templates/dlt';

interface Props {
  name: string;
  content: string;
  eventId?: string | null;
  compact?: boolean;
  category?: string | null;
  header?: string | null;
  onClean?: (content: string) => void;
}

/** Smartping/DLT view of an SMS template: {#var#} content, tagging table and copy buttons. */
export function DltSmsPanel({ name, content, eventId, compact, category, header, onClean }: Props) {
  const d = useMemo(() => toDlt(content || '', eventId, { category, header }), [content, eventId, category, header]);
  const needsClean = !!content && cleanDltSpaces(content) !== content;
  if (!content) return null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy — select the text manually');
    }
  };

  return (
    <section aria-label="DLT format for Smartping" className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Smartping / DLT format</p>
        {d.issues.length === 0 ? (
          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/25">
            <CheckCircle className="h-3 w-3 mr-1" aria-hidden /> Ready to submit
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/25">
            <AlertCircle className="h-3 w-3 mr-1" aria-hidden /> {d.issues.length} issue{d.issues.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <p className="text-xs font-mono whitespace-pre-wrap bg-muted/40 rounded-md p-2">{d.dltContent}</p>
      {!compact && (
        <>
          <p className="text-[11px] text-muted-foreground">Sample shown to DLT reviewer</p>
          <p className="text-xs whitespace-pre-wrap bg-muted/40 rounded-md p-2">{d.sampleText}</p>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        {d.length} chars · {d.segments} SMS segment{d.segments > 1 ? 's' : ''} · {d.variables.length} variable{d.variables.length === 1 ? '' : 's'}
      </p>
      {d.variables.length > 0 && (
        <table className="w-full text-xs">
          <caption className="sr-only">DLT variable tagging</caption>
          <thead>
            <tr className="text-muted-foreground text-left">
              <th scope="col" className="font-medium py-1">#</th>
              <th scope="col" className="font-medium py-1">Field</th>
              <th scope="col" className="font-medium py-1">DLT type</th>
              <th scope="col" className="font-medium py-1">Sample</th>
            </tr>
          </thead>
          <tbody>
            {d.variables.map((v) => (
              <tr key={v.position} className="border-t border-border">
                <td className="py-1 tabular-nums">{v.position}</td>
                <td className="py-1 font-mono">{v.key}</td>
                <td className="py-1">{v.type}</td>
                <td className={`py-1 ${v.tooLong ? 'text-destructive' : ''}`}>{v.sample}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.issues.length > 0 && (
        <ul className="text-[11px] text-destructive list-disc pl-4" role="alert">
          {d.issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => copy(d.dltContent, 'DLT content')}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy for Smartping
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => copy(d.sampleText, 'Sample')}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy sample
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => copy(toSmartpingRow(name, content, eventId), 'Spreadsheet row')}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy sheet row
        </Button>
      </div>
    </section>
  );
}
