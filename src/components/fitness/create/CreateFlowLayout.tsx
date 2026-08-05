import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FitnessHubTabs } from '@/components/fitness/FitnessHubTabs';

export type FlowStep = 'build' | 'preview' | 'assign';

interface Props {
  title: string;
  subtitle?: string;
  step: FlowStep;
  buildLabel?: string;
  onBack?: () => void;
  backTo?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const STEP_ORDER: FlowStep[] = ['build', 'preview', 'assign'];

export function CreateFlowLayout({ title, subtitle, step, buildLabel = 'Build', onBack, backTo, actions, children }: Props) {
  const navigate = useNavigate();
  const currentIdx = STEP_ORDER.indexOf(step);

  const labels: Record<FlowStep, string> = {
    build: buildLabel,
    preview: 'Preview',
    assign: 'Assign',
  };

  // Always resolve to an explicit destination when one is given — relying on
  // history.back() breaks after replace-navigations inside the builder.
  const goBack = () => {
    if (onBack) return onBack();
    if (backTo) return navigate(backTo);
    navigate('/fitness/create');
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <FitnessHubTabs />

        <div className="sticky top-0 z-30 -mx-2 px-2 py-3 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="h-9 w-9 shrink-0"
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </div>


        {/* Step indicator */}
        <div className="rounded-xl border bg-card p-3">
          <ol className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
            {STEP_ORDER.map((s, idx) => {
              const isCurrent = idx === currentIdx;
              const isDone = idx < currentIdx;
              return (
                <li key={s} className="flex items-center gap-2 sm:gap-4 shrink-0">
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
                      isCurrent && 'bg-primary text-primary-foreground',
                      isDone && 'bg-success/15 text-success',
                      !isCurrent && !isDone && 'bg-muted text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold',
                        isCurrent && 'bg-primary-foreground/20',
                        isDone && 'bg-success/20',
                        !isCurrent && !isDone && 'bg-background'
                      )}
                    >
                      {isDone ? <Check className="h-3 w-3" /> : idx + 1}
                    </span>
                    <span>{labels[s]}</span>
                  </div>
                  {idx < STEP_ORDER.length - 1 && (
                    <span className="h-px w-6 sm:w-12 bg-border" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {children}
      </div>
    </AppLayout>
  );
}
