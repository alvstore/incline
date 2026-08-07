import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { ChevronLeft, Check, CircleDot } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  /** Context chips rendered under the title (plan type, difficulty, day count…). */
  chips?: { label: string; tone?: 'default' | 'primary' | 'muted' }[];
  /** Hide the Build/Preview/Assign rail — template editing is a single-step flow. */
  showSteps?: boolean;
  /** When true, leaving via Back asks for confirmation first. */
  isDirty?: boolean;
  /** Shows a Saved / Unsaved changes indicator next to the title chips. */
  showSaveState?: boolean;
  children: ReactNode;
}

const STEP_ORDER: FlowStep[] = ['build', 'preview', 'assign'];

export function CreateFlowLayout({
  title,
  subtitle,
  step,
  buildLabel = 'Build',
  onBack,
  backTo,
  actions,
  chips,
  showSteps = true,
  isDirty = false,
  showSaveState = false,
  children,

}: Props) {
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const currentIdx = STEP_ORDER.indexOf(step);

  const labels: Record<FlowStep, string> = {
    build: buildLabel,
    preview: 'Preview',
    assign: 'Assign',
  };

  // Always resolve to an explicit destination when one is given — relying on
  // history.back() breaks after replace-navigations inside the builder.
  const leave = () => {
    if (onBack) return onBack();
    if (backTo) return navigate(backTo);
    navigate('/fitness/create');
  };

  const goBack = () => {
    if (isDirty) return setConfirmLeave(true);
    leave();
  };


  return (
    <AppLayout>
      <div className="space-y-5 pb-24 lg:pb-8">
        {/* Single sticky command bar: breadcrumb + title + actions. */}
        <div className="sticky top-0 z-30 -mx-2 border-b bg-background/90 px-2 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <FitnessHubTabs compact />
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="h-11 w-11 shrink-0 cursor-pointer"
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {subtitle && (
                    <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
                  )}
                  {chips?.map((c) => (
                    <Badge
                      key={c.label}
                      variant="secondary"
                      className={cn(
                        'rounded-full text-[11px] font-medium',
                        c.tone === 'primary' && 'bg-primary/10 text-primary',
                        c.tone === 'muted' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {c.label}
                    </Badge>
                  ))}
                  {showSaveState && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        isDirty
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700',
                      )}
                    >
                      {isDirty ? <CircleDot className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                      {isDirty ? 'Unsaved changes' : 'All changes saved'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {actions && (
              <div className="hidden flex-wrap items-center gap-2 sm:flex">{actions}</div>
            )}
          </div>
        </div>

        {showSteps && (
          <ol className="flex items-center gap-2 overflow-x-auto sm:gap-4">
            {STEP_ORDER.map((s, idx) => {
              const isCurrent = idx === currentIdx;
              const isDone = idx < currentIdx;
              return (
                <li key={s} className="flex shrink-0 items-center gap-2 sm:gap-4">
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200',
                      isCurrent && 'bg-primary text-primary-foreground shadow-sm',
                      isDone && 'bg-success/15 text-success',
                      !isCurrent && !isDone && 'bg-muted text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                        isCurrent && 'bg-primary-foreground/20',
                        isDone && 'bg-success/20',
                        !isCurrent && !isDone && 'bg-background',
                      )}
                    >
                      {isDone ? <Check className="h-3 w-3" /> : idx + 1}
                    </span>
                    <span>{labels[s]}</span>
                  </div>
                  {idx < STEP_ORDER.length - 1 && (
                    <span className="h-px w-6 bg-border sm:w-12" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {children}
      </div>

      {/* Mobile action bar — the sticky header hides actions below sm. */}
      {actions && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t bg-background/95 p-3 pb-safe backdrop-blur sm:hidden [&>*]:flex-1 [&_button]:w-full">
          {actions}
        </div>
      )}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              This plan has changes that haven't been saved yet. If you leave now they will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Keep editing</AlertDialogCancel>
            <AlertDialogAction className="cursor-pointer" onClick={leave}>
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
