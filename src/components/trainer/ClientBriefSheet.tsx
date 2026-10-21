import { AlertTriangle, ClipboardList, Dumbbell, Salad, Target, Wrench, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberFace } from '@/components/trainer/TrainerDashboardCards';
import { HealthGuidancePanel } from '@/components/trainer/HealthGuidancePanel';
import { useBranch } from '@/contexts/BranchContext';
import { useClientHealthDetail, useTrainerHealthAiEnabled } from '@/hooks/useTrainerHealth';
import { goalList, healthFlags, humanize, type ClientBrief } from '@/lib/trainers/clientBrief';

export interface BriefTarget {
  memberId: string; name: string; avatarUrl?: string | null;
  packageName?: string | null; expiry?: string | null;
}

function Section({ icon: Icon, title, children }: { icon: typeof Target; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />{title}
      </h3>
      {children}
    </section>
  );
}

const none = <p className="text-sm text-muted-foreground">Not shared at registration</p>;

export function ClientBriefSheet({ target, brief, onClose }: { target: BriefTarget | null; brief?: ClientBrief; onClose: () => void }) {
  const goals = goalList(brief?.fitness_goals);
  const flags = healthFlags(brief?.health_conditions);
  const equipment = brief?.equipment_availability ?? [];
  const { effectiveBranchId } = useBranch();
  const aiOn = useTrainerHealthAiEnabled(effectiveBranchId);
  const health = useClientHealthDetail(target?.memberId ?? null);
  const parqYes = health.data?.parqYes ?? [];
  const hasHealthNote = flags.length > 0 || parqYes.length > 0;
  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg [&>button]:hidden">
        <SheetHeader className="sticky top-0 z-10 flex flex-row items-center gap-3 space-y-0 border-b border-border bg-card p-5">
          <MemberFace name={target?.name} url={target?.avatarUrl} className="h-12 w-12" />
          <div className="min-w-0 flex-1 text-left">
            <SheetTitle className="truncate">{target?.name}</SheetTitle>
            <SheetDescription className="truncate">
              {target?.packageName ?? 'General training'}
              {target?.expiry ? ` · ends ${new Date(target.expiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
            </SheetDescription>
          </div>
          <SheetClose asChild><Button variant="ghost" size="icon" aria-label="Close"><X className="h-4 w-4" /></Button></SheetClose>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <Section icon={Target} title="What they're looking for">
            {goals.length ? (
              <div className="flex flex-wrap gap-2">
                {goals.map((g) => <Badge key={g} variant="outline" className="rounded-full border-accent/20 bg-accent/10 text-accent">{g}</Badge>)}
              </div>
            ) : none}
          </Section>
          <Section icon={Dumbbell} title="Fitness level">
            {brief?.fitness_level ? <p className="text-sm font-medium text-foreground">{humanize(brief.fitness_level)}</p> : none}
          </Section>
          <Section icon={AlertTriangle} title="Health conditions">
            {flags.length ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {flags.map((f) => <Badge key={f} variant="outline" className="rounded-full border-warning/20 bg-warning/10 text-warning">{f}</Badge>)}
                </div>
                <p className="text-xs text-muted-foreground">Plan loads and exercises around these. Ask before the first session.</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">{brief?.health_conditions ? 'No known conditions' : 'Not shared at registration'}</p>}
          </Section>
          <Section icon={ClipboardList} title="Health questionnaire">
            {health.isLoading ? <Skeleton className="h-10 w-full" /> : health.isError ? (
              <p className="text-sm text-muted-foreground">Couldn't load questionnaire answers.</p>
            ) : parqYes.length ? (
              <ul className="space-y-1.5">
                {parqYes.map((q) => (
                  <li key={q} className="flex gap-2 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                    <span><span className="font-medium">Yes:</span> {q}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">All answers "No" (or not filled).</p>}
            {health.data?.age ? <p className="mt-2 text-xs text-muted-foreground">Age {health.data.age}</p> : null}
          </Section>
          {hasHealthNote && aiOn && target && <HealthGuidancePanel memberId={target.memberId} />}
          <Section icon={Salad} title="Diet">
            {brief?.dietary_preference || brief?.cuisine_preference ? (
              <p className="text-sm text-foreground">{[humanize(brief?.dietary_preference), humanize(brief?.cuisine_preference)].filter(Boolean).join(' · ')}</p>
            ) : none}
          </Section>
          {equipment.length > 0 && (
            <Section icon={Wrench} title="Equipment at home">
              <p className="text-sm text-foreground">{equipment.map(humanize).join(', ')}</p>
            </Section>
          )}
        </div>
        <div className="sticky bottom-0 border-t border-border bg-card p-4">
          <SheetClose asChild><Button variant="outline" className="w-full">Close</Button></SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
