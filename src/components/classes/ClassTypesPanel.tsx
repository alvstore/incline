import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertTriangle, CalendarPlus, Clock, Dumbbell, Gift, IndianRupee, Layers, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Sparkles, Sunrise, Sun, Sunset, Trash2, UserRound, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTrainers } from '@/hooks/useTrainers';
import { useClassTypes, useDeleteClassTemplate, useDeleteClassType, useGenerateClassSessions } from '@/hooks/useClassTypes';
import { ClassTypeDrawer } from '@/components/classes/ClassTypeDrawer';
import { ScheduleRuleDrawer } from '@/components/classes/ScheduleRuleDrawer';
import { SHIFT_META, SHIFT_ORDER, formatDays, formatTime12 } from '@/lib/classes/schedule';
import { cn } from '@/lib/utils';
import type { ClassShift, ClassTemplateRow, ClassTypeRow, ClassTypeWithTemplates } from '@/types/classEngine';

interface Props {
  branchId: string;
  canManage: boolean;
}

interface TrainerLite { id: string; profile_name?: string | null; profile_email?: string | null }

const SHIFT_ICON: Record<ClassShift, typeof Sunrise> = { morning: Sunrise, afternoon: Sun, evening: Sunset };

function chargeBadge(ct: ClassTypeRow) {
  if (ct.is_paid) return { icon: IndianRupee, label: `₹${Number(ct.price).toLocaleString('en-IN')}`, cls: 'bg-warning/10 text-warning' };
  if (ct.benefit_type_id) return { icon: Gift, label: 'Plan benefit', cls: 'bg-primary/10 text-primary' };
  return { icon: Sparkles, label: 'Free', cls: 'bg-success/10 text-success' };
}

/**
 * Parent → child management: each card is a class type (Pilates) with its
 * schedule rules (Morning · 7 AM · Ritesh / Evening · 6:30 PM · Kaushay)
 * managed independently underneath.
 */
export function ClassTypesPanel({ branchId, canManage }: Props) {
  const { data: classTypes, isLoading, isError, refetch } = useClassTypes(branchId, true);
  const { data: trainers } = useTrainers(branchId);
  const generate = useGenerateClassSessions();
  const deleteTemplate = useDeleteClassTemplate();
  const deleteType = useDeleteClassType();

  const [search, setSearch] = useState('');
  const [typeDrawer, setTypeDrawer] = useState<{ open: boolean; row: ClassTypeRow | null }>({ open: false, row: null });
  const [ruleDrawer, setRuleDrawer] = useState<{ open: boolean; type: ClassTypeRow | null; rule: ClassTemplateRow | null; shift: ClassShift }>({ open: false, type: null, rule: null, shift: 'morning' });
  const [confirmRule, setConfirmRule] = useState<{ rule: ClassTemplateRow; type: ClassTypeRow } | null>(null);
  const [confirmType, setConfirmType] = useState<ClassTypeWithTemplates | null>(null);

  const trainerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (trainers ?? []) as TrainerLite[]) map.set(t.id, t.profile_name || t.profile_email || 'Trainer');
    return (id: string | null) => (id ? map.get(id) ?? 'Trainer' : null);
  }, [trainers]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classTypes ?? [];
    return (classTypes ?? []).filter((ct) =>
      ct.name.toLowerCase().includes(q)
      || (ct.description ?? '').toLowerCase().includes(q)
      || ct.templates.some((t) => (trainerName(t.trainer_id) ?? t.external_trainer_name ?? '').toLowerCase().includes(q)),
    );
  }, [classTypes, search, trainerName]);

  const handleGenerate = async () => {
    try {
      const res = await generate.mutateAsync({});
      toast.success(res.inserted > 0 ? `${res.inserted} new session${res.inserted === 1 ? '' : 's'} added` : 'Calendar already up to date', {
        description: `${res.templates} active rule${res.templates === 1 ? '' : 's'} checked for the next 30 days.`,
      });
    } catch (err) {
      toast.error('Could not generate sessions', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  const handleDeleteRule = async () => {
    if (!confirmRule) return;
    try {
      const { result, notified } = await deleteTemplate.mutateAsync({ id: confirmRule.rule.id, reason: 'Schedule discontinued' });
      setConfirmRule(null);
      toast.success('Schedule rule removed', {
        description: `${result.deleted_sessions ?? 0} empty session${result.deleted_sessions === 1 ? '' : 's'} removed, ${result.cancelled_sessions ?? 0} booked session${result.cancelled_sessions === 1 ? '' : 's'} cancelled${notified ? `, ${notified} member notice${notified === 1 ? '' : 's'} sent` : ''}.`,
      });
    } catch (err) {
      toast.error('Could not remove rule', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  const handleDeleteType = async () => {
    if (!confirmType) return;
    try {
      const res = await deleteType.mutateAsync(confirmType.id);
      setConfirmType(null);
      toast.success(`${confirmType.name} deleted`, {
        description: res.cancelled_sessions ? `${res.cancelled_sessions} booked session${res.cancelled_sessions === 1 ? '' : 's'} cancelled and members notified.` : 'All future sessions were removed.',
      });
    } catch (err) {
      toast.error('Could not delete class', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="rounded-2xl"><CardContent className="flex gap-4 p-5">
            <Skeleton className="h-24 w-24 rounded-xl" />
            <div className="flex-1 space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          </CardContent></Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="rounded-2xl"><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Could not load classes.</p>
        <Button variant="outline" className="cursor-pointer" onClick={() => refetch()}>Try again</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search classes or trainers…" className="pl-10" aria-label="Search classes" />
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="cursor-pointer" onClick={handleGenerate} disabled={generate.isPending}>
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Generate 30 days
            </Button>
            <Button size="sm" className="cursor-pointer" onClick={() => setTypeDrawer({ open: true, row: null })}>
              <Plus className="mr-2 h-4 w-4" /> New class
            </Button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <div className="mb-4 rounded-full bg-primary/10 p-4 text-primary"><Layers className="h-7 w-7" /></div>
            <h3 className="text-lg font-semibold text-foreground">{search ? 'No classes match' : 'No recurring classes yet'}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {search ? 'Try a different name or trainer.' : 'Create a class like Pilates once, then add a morning and an evening rule. Sessions generate automatically 30 days ahead.'}
            </p>
            {canManage && !search && (
              <Button className="mt-5 cursor-pointer" onClick={() => setTypeDrawer({ open: true, row: null })}>
                <Plus className="mr-2 h-4 w-4" /> Create your first class
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((ct) => {
            const charge = chargeBadge(ct);
            const ChargeIcon = charge.icon;
            const activeRules = ct.templates.filter((t) => t.is_active).length;
            return (
              <Card key={ct.id} className={cn('overflow-hidden rounded-2xl transition-all duration-200 hover:shadow-xl hover:shadow-primary/10', !ct.is_active && 'opacity-60')}>
                <CardContent className="p-0">
                  {/* Parent header */}
                  <div className="flex gap-4 p-5">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-accent/10">
                      {ct.image_url ? (
                        <img src={ct.image_url} alt={`${ct.name} class`} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center"><Dumbbell className="h-8 w-8 text-primary/40" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-bold text-foreground">{ct.name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge className={cn('rounded-full border-0 text-xs font-medium', charge.cls)}><ChargeIcon className="mr-1 h-3 w-3" />{charge.label}</Badge>
                            <Badge variant="secondary" className="rounded-full text-xs capitalize">{ct.category}</Badge>
                            {!ct.is_active && <Badge variant="outline" className="rounded-full text-xs">Paused</Badge>}
                          </div>
                        </div>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 cursor-pointer" aria-label={`More actions for ${ct.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="cursor-pointer" onClick={() => setTypeDrawer({ open: true, row: ct })}><Pencil className="mr-2 h-4 w-4" /> Edit class</DropdownMenuItem>
                              <DropdownMenuItem className="cursor-pointer" onClick={() => setRuleDrawer({ open: true, type: ct, rule: null, shift: 'morning' })}><CalendarPlus className="mr-2 h-4 w-4" /> Add schedule rule</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => setConfirmType(ct)}><Trash2 className="mr-2 h-4 w-4" /> Delete class</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {ct.description && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{ct.description}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {activeRules} active rule{activeRules === 1 ? '' : 's'} · {ct.upcoming_sessions} upcoming session{ct.upcoming_sessions === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>

                  {/* Children: schedule rules */}
                  <div className="border-t bg-muted/30 px-5 py-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule rules</p>
                      {canManage && (
                        <div className="flex gap-1">
                          {SHIFT_ORDER.map((shift) => {
                            const Icon = SHIFT_ICON[shift];
                            return (
                              <Button key={shift} variant="ghost" size="sm" className="h-8 cursor-pointer px-2 text-xs"
                                onClick={() => setRuleDrawer({ open: true, type: ct, rule: null, shift })}
                                aria-label={`Add ${SHIFT_META[shift].label.toLowerCase()} rule to ${ct.name}`}>
                                <Icon className="mr-1 h-3.5 w-3.5" /> + {SHIFT_META[shift].label}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {ct.templates.length === 0 ? (
                      <p className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">
                        No rules yet — nothing appears on the member timetable until you add one.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {ct.templates.map((rule) => {
                          const Icon = SHIFT_ICON[rule.shift_type];
                          const instructor = trainerName(rule.trainer_id) ?? rule.external_trainer_name?.trim() ?? null;
                          return (
                            <li key={rule.id} className={cn('flex items-center gap-3 rounded-xl bg-card p-3 shadow-sm transition-colors', !rule.is_active && 'opacity-60')}>
                              <div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></div>
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                                  {rule.label || `${SHIFT_META[rule.shift_type].label} batch`}
                                  <span className="font-normal text-muted-foreground">· {formatTime12(rule.start_time)} · {rule.duration_minutes} min</span>
                                  {!rule.is_active && <Badge variant="outline" className="rounded-full text-[10px]">Paused</Badge>}
                                </p>
                                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDays(rule.recurring_days)}</span>
                                  <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{instructor ?? 'No trainer'}{!rule.trainer_id && rule.external_trainer_name ? ' (guest)' : ''}</span>
                                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{rule.capacity} spots</span>
                                  {rule.valid_until && <span>until {new Date(`${rule.valid_until}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                                </p>
                              </div>
                              {canManage && (
                                <div className="flex shrink-0 gap-1">
                                  <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer" aria-label={`Edit ${ct.name} ${SHIFT_META[rule.shift_type].label.toLowerCase()} rule`}
                                    onClick={() => setRuleDrawer({ open: true, type: ct, rule, shift: rule.shift_type })}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${ct.name} ${SHIFT_META[rule.shift_type].label.toLowerCase()} rule`}
                                    onClick={() => setConfirmRule({ rule, type: ct })}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ClassTypeDrawer
        open={typeDrawer.open}
        onOpenChange={(open) => setTypeDrawer((s) => ({ ...s, open }))}
        branchId={branchId}
        classType={typeDrawer.row}
        onCreated={(row) => setRuleDrawer({ open: true, type: row, rule: null, shift: 'morning' })}
      />
      <ScheduleRuleDrawer
        open={ruleDrawer.open}
        onOpenChange={(open) => setRuleDrawer((s) => ({ ...s, open }))}
        branchId={branchId}
        classType={ruleDrawer.type}
        template={ruleDrawer.rule}
        defaultShift={ruleDrawer.shift}
      />

      <AlertDialog open={!!confirmRule} onOpenChange={(v) => { if (!v && !deleteTemplate.isPending) setConfirmRule(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the {confirmRule ? SHIFT_META[confirmRule.rule.shift_type].label.toLowerCase() : ''} rule for {confirmRule?.type.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Future sessions with no bookings are removed. Sessions that already have bookings are cancelled and members are told over the enabled channels. Past sessions and attendance stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTemplate.isPending}>Keep rule</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleDeleteRule(); }} disabled={deleteTemplate.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteTemplate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Remove rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmType} onOpenChange={(v) => { if (!v && !deleteType.isPending) setConfirmType(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmType?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the class and its {confirmType?.templates.length ?? 0} rule{confirmType?.templates.length === 1 ? '' : 's'}. Upcoming sessions are cancelled and booked members are notified. Past sessions and attendance history are kept. Prefer pausing the class if it might return.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteType.isPending}>Keep class</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleDeleteType(); }} disabled={deleteType.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteType.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete class
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
