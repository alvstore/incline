import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PtPackageBadge } from '@/components/pt/PtPackageBadge';
import { logPtSession } from '@/services/ptService';

interface TrainerTodayPanelProps {
  trainerId: string;
  ptClients: any[];
}

/**
 * Compact trainer-side panel: lists active PT clients with a one-click
 * "Mark Attended" button. Calls the atomic log_pt_session RPC, which
 * also writes a gym check-in if the member hasn't checked in today.
 */
export function TrainerTodayPanel({ trainerId, ptClients }: TrainerTodayPanelProps) {
  const queryClient = useQueryClient();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const mark = useMutation({
    mutationFn: async (packageId: string) => {
      return logPtSession({
        memberPackageId: packageId,
        trainerId,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (res: any) => {
      const left = res?.sessions_remaining;
      const type = res?.package_type;
      const msg = type === 'session_based'
        ? `Session logged · ${left ?? 0} sessions left`
        : 'Session logged · monthly plan';
      toast.success(msg, {
        description: res?.gym_check_in_created ? 'Gym check-in created' : 'Already checked in today',
      });
      setOpenFor(null);
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['trainer-pt-clients'] });
      queryClient.invalidateQueries({ queryKey: ['client-session-stats'] });
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
    },
    onError: (e: any) => {
      const code = e?.message || '';
      const friendly =
        code.includes('no_sessions_left') ? 'No PT sessions remaining on this pack' :
        code.includes('package_expired') ? 'This monthly plan has expired' :
        code.includes('package_not_active') ? 'Package is not active' :
        code.includes('not_authorized') ? 'You are not allowed to mark this session' :
        code || 'Could not log session';
      toast.error(friendly);
    },
  });

  if (!ptClients || ptClients.length === 0) {
    return null;
  }

  return (
    <Card className="rounded-2xl border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Mark Today's PT Sessions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ptClients.map((client: any) => {
          const name = client.member?.profile?.full_name || client.member?.member_code || 'Unknown';
          const initials = name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
          const pkgType = (client.package_type ?? client.package?.package_type ?? 'session_based') as 'session_based' | 'monthly';
          const isOpen = openFor === client.id;
          const isLoading = mark.isPending && isOpen;

          return (
            <div
              key={client.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarImage src={client.member?.profile?.avatar_url} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-slate-900">{name}</p>
                <p className="text-xs text-muted-foreground truncate">{client.package?.name}</p>
              </div>
              <PtPackageBadge
                packageType={pkgType}
                sessionsRemaining={client.sessions_remaining}
                sessionsTotal={client.sessions_total}
                expiryDate={client.expiry_date}
              />
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => { setOpenFor(client.id); setNotes(''); }}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Mark Attended
              </Button>

              <AlertDialog open={isOpen} onOpenChange={(v) => !v && setOpenFor(null)}>
                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Mark session attended</AlertDialogTitle>
                    <AlertDialogDescription>
                      Logs a completed PT session for <strong>{name}</strong> and
                      checks them in for today (if not already).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-600">
                      Session notes (optional)
                    </label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Focus: legs · 4 sets squat, …"
                      rows={3}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isLoading}
                      onClick={(e) => { e.preventDefault(); mark.mutate(client.id); }}
                    >
                      {isLoading ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Logging…</>
                      ) : 'Confirm'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
