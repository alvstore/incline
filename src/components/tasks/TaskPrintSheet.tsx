import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, isValid, parseISO } from 'date-fns';
import type { LinkedMember } from '@/hooks/useLinkedMembers';

interface Props {
  tasks: any[];
  filterLabel: string;
  branchLabel: string;
  linkedMembers: Record<string, LinkedMember>;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function dueLabel(due: string | null) {
  if (!due) return 'No due date';
  const d = parseISO(due);
  return isValid(d) ? format(d, 'dd MMM yyyy') : 'No due date';
}

/**
 * Printable follow-up sheet for the tasks currently in view.
 * Rendered off-screen and revealed only for `@media print`, so the app chrome
 * (sidebar, header, filters) never lands on paper.
 */
export function TaskPrintSheet({ tasks, filterLabel, branchLabel, linkedMembers }: Props) {
  const rows = [...tasks].sort((a, b) => {
    const da = a.due_date || '9999-12-31';
    const db = b.due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  });

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #task-print-sheet, #task-print-sheet * { visibility: visible !important; }
          #task-print-sheet { position: absolute; inset: 0; display: block !important; padding: 24px; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div id="task-print-sheet" className="hidden text-black">
        <h1 className="text-xl font-bold">Task follow-up sheet</h1>
        <p className="mt-1 text-xs">
          {branchLabel} · {filterLabel} · {rows.length} task{rows.length === 1 ? '' : 's'} · generated{' '}
          {format(new Date(), 'dd MMM yyyy, HH:mm')}
        </p>

        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {['Priority', 'Task', 'Member', 'Assignee', 'Due', 'Status', 'Notes / outcome'].map((h) => (
                <th key={h} className="border border-black/40 px-2 py-1 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const m = t.linked_entity_type === 'member' ? linkedMembers[t.linked_entity_id] : undefined;
              return (
                <tr key={t.id}>
                  <td className="border border-black/40 px-2 py-1 uppercase">{t.priority}</td>
                  <td className="border border-black/40 px-2 py-1">{t.title}</td>
                  <td className="border border-black/40 px-2 py-1">
                    {m ? `${m.full_name || 'Member'}${m.member_code ? ` (${m.member_code})` : ''}` : '—'}
                  </td>
                  <td className="border border-black/40 px-2 py-1">
                    {t.assignee?.full_name || t.assignee?.email || 'Unassigned'}
                  </td>
                  <td className="border border-black/40 px-2 py-1">{dueLabel(t.due_date)}</td>
                  <td className="border border-black/40 px-2 py-1">{String(t.status).replace('_', ' ')}</td>
                  <td className="border border-black/40 px-2 py-1" style={{ width: '22%', height: 28 }} />
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="border border-black/40 px-2 py-3 text-center" colSpan={7}>
                  No tasks in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PrintTasksButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => window.print()}
      className="rounded-xl cursor-pointer"
      aria-label="Print or download the current task list"
    >
      <Printer className="mr-1.5 h-4 w-4" />
      Print / Download
    </Button>
  );
}
