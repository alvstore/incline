import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Dumbbell, UtensilsCrossed, ChevronRight, Library } from 'lucide-react';
import { fetchPlanTemplates } from '@/services/fitnessService';
import { useBranchContext } from '@/contexts/BranchContext';
import type { PickedMember } from '@/components/fitness/create/MemberSearchPicker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Restrict the list to one plan type. Omit to show both. */
  planType?: 'workout' | 'diet';
  /** When set, the member is carried into the editor as URL params. */
  member?: PickedMember | null;
}

/**
 * Picks a reusable template and jumps straight into the manual editor
 * pre-loaded with it — the most common repeat action on the create page.
 */
export function TemplatePickerSheet({ open, onOpenChange, planType, member }: Props) {
  const navigate = useNavigate();
  const { effectiveBranchId } = useBranchContext();
  const [term, setTerm] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['fitness-template-picker', effectiveBranchId, planType],
    queryFn: () => fetchPlanTemplates(effectiveBranchId ?? undefined, planType),
    enabled: open,
    staleTime: 60 * 1000,
  });

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return data;
    return data.filter((t) =>
      [t.name, t.goal, t.plan_type].filter(Boolean).join(' ').toLowerCase().includes(q),
    );
  }, [data, term]);

  function openTemplate(id: string, type: string) {
    const params = new URLSearchParams();
    params.set('type', type === 'diet' ? 'diet' : 'workout');
    params.set('template', id);
    if (member) {
      params.set('memberId', member.id);
      params.set('memberName', member.full_name);
      params.set('memberCode', member.member_code);
    }
    onOpenChange(false);
    navigate(`/fitness/create/manual?${params.toString()}`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Start from a template</SheetTitle>
          <SheetDescription>
            Pick a saved {planType ? `${planType} ` : ''}plan to load into the editor
            {member ? ` for ${member.full_name}` : ''}.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-search">Search templates</Label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="template-search"
                placeholder="Search by name or goal…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl bg-muted/40 p-8 text-center">
              <Library className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">No templates found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Save a plan to the library and it will show up here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => openTemplate(t.id, t.plan_type)}
                    aria-label={`Use template ${t.name}`}
                    className="group flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-xl bg-card p-3 text-left ring-1 ring-border transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        t.plan_type === 'diet'
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-primary/10 text-primary'
                      }`}
                      aria-hidden
                    >
                      {t.plan_type === 'diet' ? (
                        <UtensilsCrossed className="h-4 w-4" />
                      ) : (
                        <Dumbbell className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {t.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[t.goal, t.duration_weeks ? `${t.duration_weeks} weeks` : null]
                          .filter(Boolean)
                          .join(' · ') || 'No goal set'}
                      </span>
                    </span>
                    {t.is_common && (
                      <Badge className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                        Shared
                      </Badge>
                    )}
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
