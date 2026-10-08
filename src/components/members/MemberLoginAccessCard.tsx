import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { KeyRound, Loader2, ShieldOff, ShieldCheck, UserX } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

interface LoginState {
  user_id: string | null;
  login_disabled_at: string | null;
  login_disabled_reason: string | null;
  login_disabled_source: string | null;
}

const ERRORS: Record<string, string> = {
  reason_required: 'Please add a short reason.',
  no_login: 'This member has no app login yet.',
  staff_account: 'This login also belongs to a staff account — manage it from HRM.',
  forbidden: 'You can only manage members of your branch.',
};

async function callAccess(action: 'disable' | 'enable', memberId: string, reason?: string) {
  const { data, error } = await supabase.functions.invoke('member-login-access', {
    body: { action, member_id: memberId, reason },
  });
  let code = (data as { error?: string } | null)?.error;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    try { code = ((await ctx?.clone().json()) as { error?: string })?.error ?? code; } catch { /* ignore */ }
    if (!code) code = error.message;
  }
  if (code) throw new Error(ERRORS[code] ?? code);
}

export function MemberLoginAccessCard({ memberId }: { memberId: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'disable' | 'enable' | null>(null);
  const [reason, setReason] = useState('');
  const key = ['member-login-access', memberId];

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LoginState | null> => {
      const { data, error } = await supabase
        .from('members')
        .select('user_id, login_disabled_at, login_disabled_reason, login_disabled_source')
        .eq('id', memberId)
        .maybeSingle();
      if (error) throw error;
      return data as LoginState | null;
    },
  });

  const mutation = useMutation({
    mutationFn: (action: 'disable' | 'enable') => callAccess(action, memberId, reason.trim()),
    onSuccess: (_d, action) => {
      toast.success(action === 'disable' ? 'App login disabled' : 'App login enabled');
      setConfirm(null);
      setReason('');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disabled = !!data?.login_disabled_at;
  const auto = data?.login_disabled_source === 'auto';
  const pill = !data?.user_id
    ? { label: 'No login', cls: 'bg-muted text-muted-foreground border-border', Icon: UserX }
    : disabled
      ? { label: auto ? 'Auto-revoked' : 'Disabled', cls: 'bg-destructive/10 text-destructive border-destructive/20', Icon: ShieldOff }
      : { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', Icon: ShieldCheck };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <KeyRound className="h-4 w-4" aria-hidden />
          App access
          {!isLoading && !isError && (
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${pill.cls}`}>
              <pill.Icon className="h-3 w-3" aria-hidden />{pill.label}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : isError ? (
          <p className="text-xs text-destructive">Could not load login status.</p>
        ) : !data?.user_id ? (
          <p className="text-xs text-muted-foreground">This member has not been given an app login.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {disabled
                ? `${auto ? 'Revoked automatically' : 'Disabled'} on ${format(new Date(data.login_disabled_at!), 'dd MMM yyyy, HH:mm')}${data.login_disabled_reason ? ` · ${data.login_disabled_reason}` : ''}`
                : 'Member can sign in to the app. Login is revoked automatically 7 days after membership ends.'}
            </p>
            <Button
              size="sm"
              variant={disabled ? 'default' : 'outline'}
              className="min-h-11 w-full sm:w-auto"
              onClick={() => setConfirm(disabled ? 'enable' : 'disable')}
            >
              {disabled ? <ShieldCheck className="mr-1.5 h-4 w-4" /> : <ShieldOff className="mr-1.5 h-4 w-4" />}
              {disabled ? 'Enable login' : 'Disable login'}
            </Button>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'disable' ? 'Disable app login?' : 'Enable app login?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'disable'
                ? 'The member will be signed out and cannot log in until you enable it again. No message is sent.'
                : auto
                  ? 'Their membership has ended, so the automatic check will revoke the login again within the hour unless they renew.'
                  : 'The member will be able to sign in again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === 'disable' && (
            <div className="space-y-1.5">
              <Label htmlFor="login-disable-reason">Reason (required)</Label>
              <Textarea id="login-disable-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-required />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || (confirm === 'disable' && reason.trim().length < 3)}
              onClick={(e) => { e.preventDefault(); if (confirm) mutation.mutate(confirm); }}
            >
              {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {confirm === 'disable' ? 'Disable login' : 'Enable login'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
