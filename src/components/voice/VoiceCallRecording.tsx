import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Headphones } from 'lucide-react';

interface RecordingResponse {
  ok: boolean;
  url?: string;
  error?: string;
}

export function VoiceCallRecording({ callId }: { callId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['voice-call-recording', callId],
    staleTime: 4 * 60_000,
    retry: false,
    queryFn: async (): Promise<string> => {
      const { data: res, error: fnError } = await supabase.functions.invoke<RecordingResponse>('sarvam-voice', {
        body: { action: 'get_recording', call_id: callId },
      });
      if (fnError) throw fnError;
      if (!res?.ok || !res.url) throw new Error(res?.error ?? 'No recording available for this call.');
      return res.url;
    },
  });

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Headphones className="h-4 w-4" aria-hidden /> Recording
      </p>
      {isLoading && <Skeleton className="h-12 w-full rounded-2xl" />}
      {isError && (
        <p className="rounded-2xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          {(error as Error)?.message || 'Recording is not available for this call.'}
        </p>
      )}
      {data && (
        <audio controls preload="metadata" src={data} className="w-full" aria-label="Call recording">
          Your browser does not support audio playback.
        </audio>
      )}
    </div>
  );
}

export default VoiceCallRecording;
