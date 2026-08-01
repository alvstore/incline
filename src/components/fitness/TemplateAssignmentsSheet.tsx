import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Users, CalendarClock, UserX } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchAssignmentsForTemplate, MemberAssignmentRow } from '@/services/fitnessService';
import { SendPlanPdfMenu } from '@/components/fitness/SendPlanPdfMenu';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: { id: string; name: string } | null;
  branchId?: string | null;
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fmt(date?: string | null) {
  if (!date) return '—';
  try {
    return format(new Date(date), 'dd MMM yyyy');
  } catch {
    return date;
  }
}

export function TemplateAssignmentsSheet({ open, onOpenChange, template, branchId }: Props) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ['fitness-template-assignments', template?.id],
    queryFn: () => fetchAssignmentsForTemplate(template!.id),
    enabled: open && !!template?.id,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        <SheetHeader className="px-5 py-4 border-b text-left">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Assigned Members
          </SheetTitle>
          <SheetDescription>
            Everyone assigned <span className="font-medium text-foreground">{template?.name}</span>
            {rows.length > 0 && ` — ${rows.length} member${rows.length === 1 ? '' : 's'}`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-5 py-4 space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))
            ) : isError ? (
              <p className="text-sm text-destructive py-8 text-center">
                Could not load assignments. Please retry.
              </p>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <UserX className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No members have been assigned this template yet.
                </p>
              </div>
            ) : (
              rows.map((a: MemberAssignmentRow) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 bg-background p-3 hover:bg-muted/30 transition"
                >
                  <Avatar className="h-9 w-9">
                    {a.avatar_url && <AvatarImage src={a.avatar_url} alt={a.member_name} />}
                    <AvatarFallback className="text-xs">{initials(a.member_name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{a.member_name}</p>
                      {a.member_code && (
                        <Badge variant="outline" className="text-[10px] py-0 h-4">
                          {a.member_code}
                        </Badge>
                      )}
                      <Badge
                        className={
                          a.is_expired
                            ? 'bg-destructive/10 text-destructive border-destructive/25 text-[10px] py-0 h-4'
                            : 'bg-success/10 text-success border-success/25 text-[10px] py-0 h-4'
                        }
                      >
                        {a.is_expired ? 'Expired' : 'Active'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {fmt(a.valid_from || a.created_at)} → {fmt(a.valid_until)}
                      </span>
                      {a.trainer_name && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span>by {a.trainer_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <SendPlanPdfMenu
                    size="sm"
                    variant="outline"
                    triggerLabel="Resend"
                    member={{
                      id: a.member_id,
                      full_name: a.member_name,
                      phone: a.phone,
                      email: a.email,
                    }}
                    plan={{
                      name: a.plan_name,
                      type: a.plan_type,
                      description: a.description,
                      data: a.plan_data,
                      valid_from: a.valid_from,
                      valid_until: a.valid_until,
                      trainer_name: a.trainer_name,
                    }}
                    branchId={a.branch_id || branchId || undefined}
                  />
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-5 py-3 bg-background">
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
