import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PhoneCall } from 'lucide-react';
import { useMemberVoiceCalls } from '@/hooks/useVoiceOps';
import { dispositionLook } from '@/lib/voice/voiceOutcomes';
import { VoiceCallDetailSheet } from '@/components/voice/VoiceCallDetailSheet';
import { format } from 'date-fns';

/** Voice AI call history for a single member — reads the sanitized feed RPC. */
export function MemberVoiceAIHistory({ memberId }: { memberId: string }) {
  const { data, isLoading } = useMemberVoiceCalls(memberId);
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
        No Voice AI calls for this member yet.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {data.map((call) => {
          const look = dispositionLook(call.disposition);
          return (
            <li key={call.id}>
              <button
                type="button"
                onClick={() => setOpenCallId(call.id)}
                className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-2xl bg-muted/40 p-3 text-left transition-colors duration-150 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <PhoneCall className="h-4 w-4 text-indigo-600" aria-hidden />
                    {call.call_started_at ? format(new Date(call.call_started_at), 'dd MMM yyyy, HH:mm') : '—'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {call.reason_for_absence ? `Reason: ${call.reason_for_absence}` : 'Retention call'}
                    {call.next_step_agreed ? ` · Next: ${call.next_step_agreed}` : ''}
                  </p>
                </div>
                {look && <Badge className={`shrink-0 rounded-full ${look.className}`}>{look.label}</Badge>}
              </button>
            </li>
          );
        })}
      </ul>
      <VoiceCallDetailSheet
        callId={openCallId}
        open={!!openCallId}
        onOpenChange={(v) => { if (!v) setOpenCallId(null); }}
      />
    </>
  );
}

export default MemberVoiceAIHistory;
