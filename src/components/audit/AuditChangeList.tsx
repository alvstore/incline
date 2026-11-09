import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { changeList, type AuditRowLike } from '@/lib/audit/humanize';

/** Plain-language list of what changed, with technical fields tucked away. */
export function AuditChangeList({ row }: { row: AuditRowLike }) {
  const [showTech, setShowTech] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const all = changeList(row);
  const visible = all.filter((c) => showTech || !c.technical);
  const techCount = all.filter((c) => c.technical).length;
  const isUpdate = row.action === 'UPDATE';

  if (all.length === 0) {
    const meta = row.new_data ?? row.old_data;
    if (!meta) return <p className="text-sm text-muted-foreground">No details were recorded for this event.</p>;
    return <p className="text-sm text-muted-foreground">Only internal timestamps changed.</p>;
  }

  return (
    <div className="space-y-2">
      {visible.length === 0 && <p className="text-sm text-muted-foreground">Only technical fields changed.</p>}
      <dl className="divide-y divide-border rounded-xl border border-border bg-card">
        {visible.map((c) => {
          const open = expanded.has(c.key);
          return (
            <div key={c.key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[160px_1fr] sm:gap-3">
              <dt className="text-sm font-medium text-muted-foreground">{c.label}</dt>
              <dd className="min-w-0 text-sm text-foreground">
                {isUpdate ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground line-through decoration-muted-foreground/50 break-words">{c.before}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="changed to" />
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 font-medium text-foreground break-words">{c.after}</span>
                  </span>
                ) : (
                  <span className="break-words">{c.after}</span>
                )}
                {c.long && !open && (
                  <button type="button" className="ml-2 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setExpanded((s) => new Set(s).add(c.key))}>Show full</button>
                )}
                {c.long && open && (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs">
                    {JSON.stringify(isUpdate ? { before: row.old_data?.[c.key], after: row.new_data?.[c.key] } : (row.new_data ?? row.old_data)?.[c.key], null, 2)}
                  </pre>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {techCount > 0 && (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 text-xs" aria-expanded={showTech} onClick={() => setShowTech((v) => !v)}>
          {showTech ? 'Hide technical details' : `Show technical details (${techCount})`}
        </Button>
      )}
    </div>
  );
}
