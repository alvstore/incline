import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Search, Users, Dumbbell, FileText, Building2, Wallet, Calendar, CheckSquare,
  ArrowRight, Clock, Zap, History,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePageShortcuts } from './usePageShortcuts';
import { COMMAND_ACTIONS, filterActionsForRoles } from './commandActions';
import { useRecentCommands, type RecentCommand } from './useRecentCommands';
import {
  useMembersSearch, useInvoicesSearch, useLeadsSearch, useTrainersSearch,
  usePaymentsSearch, useBookingsSearch, useTasksSearch,
} from './useCommandSearch';

interface GlobalSearchProps { className?: string }

function statusBadgeClass(s?: string) {
  if (!s) return 'bg-muted text-muted-foreground';
  const v = s.toLowerCase();
  if (['active','paid','completed','confirmed','converted','booked','attended'].includes(v)) return 'bg-success/15 text-success';
  if (['frozen','paused','draft','pending'].includes(v)) return 'bg-info/15 text-info';
  if (['overdue','expired','cancelled','no_show','failed','lost'].includes(v)) return 'bg-destructive/15 text-destructive';
  if (['partial','negotiation','warm','contacted'].includes(v)) return 'bg-warning/15 text-warning';
  if (['hot'].includes(v)) return 'bg-destructive/15 text-destructive';
  if (['cold','new'].includes(v)) return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}

function ResultRow({
  icon: Icon, title, subtitle, branchName, status, onSelect, color = 'indigo',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  branchName?: string | null;
  status?: string;
  onSelect: () => void;
  color?: 'indigo'|'amber'|'emerald'|'rose'|'sky'|'violet';
}) {
  const tone: Record<string,string> = {
    indigo: 'bg-primary/10 text-primary',
    amber:  'bg-warning/10 text-warning',
    emerald:'bg-success/10 text-success',
    rose:   'bg-destructive/10 text-destructive',
    sky:    'bg-info/10 text-info',
    violet: 'bg-primary/10 text-primary',
  };
  return (
    <CommandItem onSelect={onSelect} className="flex items-center gap-3 cursor-pointer rounded-lg" value={`${title} ${subtitle ?? ''} ${branchName ?? ''}`}>
      <div className={cn('flex items-center justify-center w-8 h-8 rounded-lg', tone[color])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate text-sm">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
      </div>
      {branchName && (
        <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 shrink-0 hidden sm:inline-flex">
          {branchName}
        </Badge>
      )}
      {status && (
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium capitalize shrink-0', statusBadgeClass(status))}>
          {status.replace(/_/g,' ')}
        </span>
      )}
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
    </CommandItem>
  );
}

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="px-2 py-1 space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-1.5">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GlobalSearch({ className }: GlobalSearchProps) {
  const navigate = useNavigate();
  const { roles, hasAnyRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // Debounce 250ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Hotkey ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const rolesSet = useMemo(() => new Set(roles.map((r) => r.role)), [roles]);
  const isMember = hasAnyRole(['member']) && !hasAnyRole(['owner','admin','manager','staff','trainer']);

  const pages = usePageShortcuts(query);
  const actions = useMemo(() => isMember ? [] : filterActionsForRoles(rolesSet, query), [rolesSet, query, isMember]);
  const recent = useRecentCommands();

  const term = debounced;
  const term2plus = term.length >= 2;

  // Searches (each gated by role inside hook)
  const members  = useMembersSearch({ term });
  const invoices = useInvoicesSearch({ term });
  const leads    = useLeadsSearch({ term });
  const trainers = useTrainersSearch({ term });
  const payments = usePaymentsSearch({ term });
  const bookings = useBookingsSearch({ term });
  const tasks    = useTasksSearch({ term });

  const anyLoading = term2plus && (members.isLoading || invoices.isLoading || leads.isLoading || trainers.isLoading || payments.isLoading || bookings.isLoading || tasks.isLoading);
  const anyResults = (members.data?.length || invoices.data?.length || leads.data?.length || trainers.data?.length || payments.data?.length || bookings.data?.length || tasks.data?.length) || 0;

  const close = () => { setOpen(false); setQuery(''); setDebounced(''); };

  const go = (route: string, recentEntry?: Omit<RecentCommand,'ts'>) => {
    if (recentEntry) recent.push(recentEntry);
    navigate(route);
    close();
  };

  const showDefaults = !term2plus;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-2 h-9 w-full max-w-sm rounded-lg border border-input bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          className
        )}
        aria-label="Open command palette"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(''); }}>
        <CommandInput
          placeholder={isMember ? 'Search pages…' : 'Search members, leads, invoices, bookings, tasks…'}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[460px]">
          {showDefaults && recent.items.length > 0 && (
            <CommandGroup heading="Recent">
              {recent.items.map((r) => (
                <ResultRow
                  key={`recent-${r.kind}-${r.id}`}
                  icon={History}
                  title={r.label}
                  subtitle={r.sublabel}
                  color="violet"
                  onSelect={() => go(r.route)}
                />
              ))}
            </CommandGroup>
          )}

          {showDefaults && actions.length > 0 && (
            <>
              {recent.items.length > 0 && <CommandSeparator />}
              <CommandGroup heading="Actions">
                {actions.map((a) => (
                  <ResultRow
                    key={a.id}
                    icon={a.icon}
                    title={a.label}
                    color="indigo"
                    onSelect={() => go(a.route, { kind: 'action', id: a.id, label: a.label, route: a.route })}
                  />
                ))}
              </CommandGroup>
            </>
          )}

          {pages.length > 0 && (
            <>
              {(showDefaults && (recent.items.length > 0 || actions.length > 0)) && <CommandSeparator />}
              <CommandGroup heading="Pages">
                {pages.map((p) => (
                  <ResultRow
                    key={p.href}
                    icon={p.icon}
                    title={p.label}
                    color="sky"
                    onSelect={() => go(p.href, { kind: 'page', id: p.href, label: p.label, route: p.href })}
                  />
                ))}
              </CommandGroup>
            </>
          )}

          {/* When typing — show searched entities */}
          {term2plus && !isMember && (
            <>
              {!!actions.length && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Actions">
                    {actions.map((a) => (
                      <ResultRow key={a.id} icon={a.icon} title={a.label} color="indigo" onSelect={() => go(a.route, { kind: 'action', id: a.id, label: a.label, route: a.route })} />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Members */}
              <CommandSeparator />
              <CommandGroup heading="Members">
                {members.isLoading && <SectionSkeleton />}
                {!members.isLoading && members.data?.length === 0 && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">No members</div>
                )}
                {members.data?.map((m: any) => (
                  <ResultRow
                    key={`mem-${m.id}`}
                    icon={Users}
                    title={m.full_name || m.member_code}
                    subtitle={[m.member_code, m.phone, m.email].filter(Boolean).join(' · ')}
                    branchName={m.branch_name}
                    status={m.status}
                    color="indigo"
                    onSelect={() => go(`/members?member=${m.id}`, { kind: 'member', id: m.id, label: m.full_name || m.member_code, sublabel: m.member_code, route: `/members?member=${m.id}` })}
                  />
                ))}
              </CommandGroup>

              {/* Leads */}
              {(leads.isLoading || (leads.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Leads">
                    {leads.isLoading && <SectionSkeleton />}
                    {leads.data?.map((l: any) => (
                      <ResultRow
                        key={`lead-${l.id}`}
                        icon={Building2}
                        title={l.full_name}
                        subtitle={[l.phone, l.email].filter(Boolean).join(' · ')}
                        branchName={l.branch_name}
                        status={l.temperature || l.status}
                        color="amber"
                        onSelect={() => go(`/leads?lead=${l.id}`, { kind: 'lead', id: l.id, label: l.full_name, route: `/leads?lead=${l.id}` })}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Invoices */}
              {(invoices.isLoading || (invoices.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Finance · Invoices">
                    {invoices.isLoading && <SectionSkeleton />}
                    {invoices.data?.map((i: any) => (
                      <ResultRow
                        key={`inv-${i.id}`}
                        icon={FileText}
                        title={i.invoice_number || `Invoice`}
                        subtitle={[i.member_name, `₹${Number(i.total_amount || 0).toLocaleString()}`].filter(Boolean).join(' · ')}
                        branchName={i.branch_name}
                        status={i.status}
                        color="emerald"
                        onSelect={() => go(`/invoices?invoice=${i.id}`, { kind: 'invoice', id: i.id, label: i.invoice_number || 'Invoice', sublabel: i.member_name, route: `/invoices?invoice=${i.id}` })}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Payments */}
              {(payments.isLoading || (payments.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Finance · Payments">
                    {payments.isLoading && <SectionSkeleton />}
                    {payments.data?.map((p: any) => (
                      <ResultRow
                        key={`pay-${p.id}`}
                        icon={Wallet}
                        title={`₹${Number(p.amount || 0).toLocaleString()} · ${p.payment_method}`}
                        subtitle={[p.member_name, p.invoice_number].filter(Boolean).join(' · ')}
                        branchName={p.branch_name}
                        status={p.status}
                        color="emerald"
                        onSelect={() => p.invoice_id ? go(`/invoices?invoice=${p.invoice_id}`) : go(`/payments?focus=${p.id}`)}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Bookings */}
              {(bookings.isLoading || (bookings.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Bookings">
                    {bookings.isLoading && <SectionSkeleton />}
                    {bookings.data?.map((b: any) => (
                      <ResultRow
                        key={`bk-${b.id}`}
                        icon={Calendar}
                        title={b.title}
                        subtitle={[b.kind?.toUpperCase(), b.when_at ? new Date(b.when_at).toLocaleString() : ''].filter(Boolean).join(' · ')}
                        branchName={b.branch_name}
                        status={b.status}
                        color="sky"
                        onSelect={() => go(`/all-bookings?focus=${b.id}`, { kind: 'booking', id: b.id, label: b.title, route: `/all-bookings?focus=${b.id}` })}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Trainers */}
              {(trainers.isLoading || (trainers.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Trainers">
                    {trainers.isLoading && <SectionSkeleton />}
                    {trainers.data?.map((t: any) => (
                      <ResultRow
                        key={`tr-${t.id}`}
                        icon={Dumbbell}
                        title={t.full_name || 'Trainer'}
                        subtitle={[t.phone, t.email].filter(Boolean).join(' · ')}
                        branchName={t.branch_name}
                        status={t.is_active ? 'active' : 'inactive'}
                        color="violet"
                        onSelect={() => go(`/trainers?trainer=${t.id}`, { kind: 'trainer', id: t.id, label: t.full_name || 'Trainer', route: `/trainers?trainer=${t.id}` })}
                      />
                    ))}
                  </CommandGroup>
                </>
              )}

              {/* Tasks */}
              {(tasks.isLoading || (tasks.data?.length ?? 0) > 0) && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Tasks">
                    {tasks.isLoading && <SectionSkeleton />}
                    {tasks.data?.map((t: any) => {
                      const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed';
                      return (
                        <ResultRow
                          key={`tsk-${t.id}`}
                          icon={CheckSquare}
                          title={t.title}
                          subtitle={[t.assignee_name, t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : ''].filter(Boolean).join(' · ')}
                          branchName={t.branch_name}
                          status={overdue ? 'overdue' : t.status}
                          color="rose"
                          onSelect={() => go(`/tasks?task=${t.id}`, { kind: 'task', id: t.id, label: t.title, route: `/tasks?task=${t.id}` })}
                        />
                      );
                    })}
                  </CommandGroup>
                </>
              )}

              {!anyLoading && anyResults === 0 && (
                <CommandEmpty>
                  <div className="text-center py-6 text-sm">
                    <div className="font-medium text-foreground">No matches for “{term}”</div>
                    <div className="text-xs text-muted-foreground mt-1">Try a member name, code, phone, invoice number, or task title.</div>
                  </div>
                </CommandEmpty>
              )}
            </>
          )}

          {showDefaults && recent.items.length === 0 && actions.length === 0 && pages.length === 0 && (
            <CommandEmpty>Type to search.</CommandEmpty>
          )}
        </CommandList>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/40 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="rounded border bg-background px-1.5 font-mono">↵</kbd> Open</span>
            <span className="flex items-center gap-1"><kbd className="rounded border bg-background px-1.5 font-mono">Esc</kbd> Close</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            <span>Command Center</span>
          </div>
        </div>
      </CommandDialog>
    </>
  );
}
