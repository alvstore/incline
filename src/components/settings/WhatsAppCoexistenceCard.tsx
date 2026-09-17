import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Smartphone,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  History,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';

interface CoexistenceStatus {
  display_phone_number: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  platform_type: string | null;
  coexistence_enabled: boolean;
  linked_at: string | null;
  history_sync: { requested_at?: string; ok?: boolean } | null;
}

const STEPS = [
  'Open the number in your provider onboarding and choose the coexistence option.',
  'On the phone running WhatsApp Business, open Settings and scan the code shown during onboarding.',
  'Approve the link on the phone. The account is linked, never deleted or migrated.',
  'Come back here and request the one-time chat history import within 24 hours of linking.',
];

export function WhatsAppCoexistenceCard() {
  const { effectiveBranchId } = useBranchContext();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['whatsapp-coexistence', effectiveBranchId],
    queryFn: async (): Promise<CoexistenceStatus> => {
      const { data, error } = await supabase.functions.invoke('whatsapp-coexistence', {
        body: { action: 'status', branch_id: effectiveBranchId },
      });
      if (error) throw error;
      return data as CoexistenceStatus;
    },
    enabled: Boolean(effectiveBranchId),
  });

  const syncHistory = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-coexistence', {
        body: { action: 'request_history_sync', branch_id: effectiveBranchId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('History import requested. Older chats will arrive shortly.');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-coexistence', effectiveBranchId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'WhatsApp refused the history import request.');
    },
  });

  return (
    <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
            <Smartphone size={20} aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base font-bold text-slate-900">Phone app coexistence</CardTitle>
            <p className="text-sm text-slate-500">
              Keep chatting from the WhatsApp Business app while the system runs on the same number.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['whatsapp-coexistence', effectiveBranchId] })}
          aria-label="Refresh coexistence status"
        >
          <RefreshCw size={16} className="mr-2" aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>
        )}

        {isError && (
          <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4">
            <AlertTriangle size={18} className="mt-0.5 text-red-600" aria-hidden="true" />
            <p className="text-sm text-red-700">
              {(error as Error)?.message || 'Could not read the WhatsApp number right now.'}
            </p>
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Number</p>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {data.display_phone_number || 'Not available'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Coexistence</p>
                <span
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    data.coexistence_enabled
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {data.coexistence_enabled ? (
                    <CheckCircle2 size={12} aria-hidden="true" />
                  ) : (
                    <Info size={12} aria-hidden="true" />
                  )}
                  {data.coexistence_enabled ? 'Linked to phone app' : 'Not linked yet'}
                </span>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quality</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{data.quality_rating || 'Unknown'}</p>
              </div>
            </div>

            {data.coexistence_enabled ? (
              <div className="flex flex-col gap-3 rounded-xl bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-emerald-800">
                  Messages typed on the phone now appear here, and messages sent here appear on the phone.
                  {data.history_sync?.requested_at
                    ? ` Last history import requested ${new Date(data.history_sync.requested_at).toLocaleString()}.`
                    : ''}
                </p>
                <Button
                  onClick={() => syncHistory.mutate()}
                  disabled={syncHistory.isPending}
                  className="cursor-pointer rounded-xl bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {syncHistory.isPending ? (
                    <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <History size={16} className="mr-2" aria-hidden="true" />
                  )}
                  Import past chats
                </Button>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">How to link the phone</p>
                <ol className="mt-3 space-y-2">
                  {STEPS.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-relaxed text-slate-600">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="mt-4 text-sm leading-relaxed text-slate-500">
                  If linking fails with &quot;number already connected&quot;, open the WhatsApp Business app,
                  go to Settings, Account, Business Platform, disconnect the account, then link again.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
