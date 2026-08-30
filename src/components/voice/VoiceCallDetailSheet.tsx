import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ChevronDown, ChevronRight, PhoneCall, ShieldAlert } from 'lucide-react';
import { useVoiceCallDetail } from '@/hooks/useVoiceOps';
import { dispositionLook, statusLook, formatDuration } from '@/lib/voice/voiceOutcomes';
import { format } from 'date-fns';

interface Props {
  callId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-right text-foreground">{value ?? '—'}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="rounded-2xl bg-muted/40 px-4 py-2">{children}</div>
    </div>
  );
}

function fmt(value?: string | null, pattern = 'dd MMM yyyy, HH:mm') {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : format(d, pattern);
}

function renderTranscript(transcript: unknown): string {
  if (!transcript) return '';
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript)) {
    return transcript
      .map((turn) => {
        if (typeof turn === 'string') return turn;
        const t = turn as Record<string, unknown>;
        const who = String(t.role ?? t.speaker ?? 'turn');
        const text = String(t.text ?? t.content ?? t.message ?? '');
        return text ? `${who}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function VoiceCallDetailSheet({ callId, open, onOpenChange }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const { data, isLoading, isError } = useVoiceCallDetail(open ? callId : null);

  const disposition = dispositionLook(data?.disposition);
  const status = statusLook(data?.status);
  const transcriptText = renderTranscript(data?.transcript);

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setShowTranscript(false); }}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-indigo-600" aria-hidden />
            Voice AI call
          </SheetTitle>
          <SheetDescription>Retention call details from Incline Member Care.</SheetDescription>
        </SheetHeader>

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        )}

        {isError && (
          <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            You do not have access to this call, or it could not be loaded.
          </div>
        )}

        {data && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge className={`rounded-full ${status.className}`}>{status.label}</Badge>
              {disposition && <Badge className={`rounded-full ${disposition.className}`}>{disposition.label}</Badge>}
            </div>

            <Section title="Member">
              <Row label="Name" value={data.member_name} />
              <Row label="Member code" value={data.member_code} />
              <Row label="Phone" value={data.masked_phone} />
              <Row label="Branch" value={data.branch_name} />
              <Row label="Membership" value={data.member_status} />
              <Row label="Plan" value={data.plan_name} />
              <Row label="Trainer" value={data.trainer_name} />
            </Section>

            <Section title="Retention context">
              <Row label="Reason for call" value={data.reason ?? 'member_retention'} />
              <Row label="Last visit" value={fmt(data.last_visit, 'dd MMM yyyy')} />
              <Row label="Eligible at" value={fmt(data.eligible_at)} />
              <Row label="Plan expiry" value={fmt(data.plan_expiry, 'dd MMM yyyy')} />
            </Section>

            <Section title="Call">
              <Row label="Started" value={fmt(data.started_at)} />
              <Row label="Ended" value={fmt(data.ended_at)} />
              <Row label="Duration" value={formatDuration(data.duration_seconds)} />
              <Row label="Attempt ID" value={<span className="font-mono text-xs">{data.provider_attempt_id ?? '—'}</span>} />
              <Row label="Interaction ID" value={<span className="font-mono text-xs">{data.interaction_id ?? '—'}</span>} />
              {data.error_message && <Row label="Failure" value={data.error_message} />}
            </Section>

            <Section title="AI outcome">
              <Row label="Disposition" value={disposition?.label} />
              <Row label="Reason for absence" value={data.reason_for_absence} />
              <Row label="Next step" value={data.next_step_agreed} />
              <Row label="Callback time" value={data.callback_datetime} />
              <Row label="Summary" value={data.call_summary} />
            </Section>

            {data.tasks?.length > 0 && (
              <Section title="Action required">
                {data.tasks.map((t) => (
                  <Row
                    key={t.id}
                    label={t.title}
                    value={<Badge variant="secondary" className="rounded-full">{t.status}</Badge>}
                  />
                ))}
              </Section>
            )}

            <Separator />

            <div>
              {data.can_view_transcript ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer px-0"
                    onClick={() => setShowTranscript((v) => !v)}
                    aria-expanded={showTranscript}
                  >
                    {showTranscript ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Transcript
                  </Button>
                  {showTranscript && (
                    <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
                      {transcriptText || 'No transcript was returned for this call.'}
                    </pre>
                  )}
                </>
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" aria-hidden />
                  Transcripts are limited to managers and above.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default VoiceCallDetailSheet;
