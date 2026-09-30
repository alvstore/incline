import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CalendarClock, ChevronDown, ChevronRight, ClipboardList, ExternalLink,
  Headphones, Loader2, PhoneCall, ShieldAlert, Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useVoiceCallDetail } from '@/hooks/useVoiceOps';
import { dispositionLook, formatDuration, statusLook } from '@/lib/voice/voiceOutcomes';
import { createTask } from '@/services/taskService';
import { VoiceCallRecording } from './VoiceCallRecording';
import { format } from 'date-fns';

interface VoiceCallWorkspaceProps {
  callId: string | null;
  onOpenFullDetail: (callId: string) => void;
}

interface TranscriptTurn { who: 'agent' | 'member'; text: string }

function parseTranscript(transcript: unknown): TranscriptTurn[] {
  if (!transcript) return [];
  if (typeof transcript === 'string') return [{ who: 'agent', text: transcript }];
  if (!Array.isArray(transcript)) return [];
  return transcript
    .map((turn): TranscriptTurn | null => {
      if (typeof turn === 'string') return { who: 'agent', text: turn };
      const t = turn as Record<string, unknown>;
      const role = String(t.role ?? t.speaker ?? '').toLowerCase();
      const text = String(t.en_text ?? t.text ?? t.content ?? t.message ?? t.indic_text ?? '').trim();
      if (!text) return null;
      return { who: role === 'agent' || role === 'assistant' || role === 'bot' ? 'agent' : 'member', text };
    })
    .filter((x): x is TranscriptTurn => x !== null);
}

function fmt(value?: string | null, pattern = 'dd MMM yyyy, HH:mm') {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : format(d, pattern);
}

/** Centre pane: who was called, how it went, the recording and the transcript. */
export function VoiceCallWorkspace({ callId, onOpenFullDetail }: VoiceCallWorkspaceProps) {
  const { data, isLoading, isError } = useVoiceCallDetail(callId);
  const [showTranscript, setShowTranscript] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const turns = useMemo(() => parseTranscript(data?.transcript), [data?.transcript]);

  /** Three plain-language takeaways, read straight from the call outcome. */
  const highlights = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    const disposition = dispositionLook(data.disposition);
    if (disposition) out.push(`Outcome: ${disposition.label}.`);
    if (data.reason_for_absence) out.push(`Member said: ${data.reason_for_absence}`);
    if (data.next_step_agreed) out.push(`Agreed next step: ${data.next_step_agreed}`);
    if (data.callback_datetime) out.push(`Callback requested for ${data.callback_datetime}.`);
    if (data.call_summary) out.push(data.call_summary);
    if (out.length === 0) {
      out.push(`Call ${statusLook(data.status).label.toLowerCase()} after ${formatDuration(data.duration_seconds)}.`);
      out.push('No outcome was captured by the agent for this call.');
    }
    return out.slice(0, 3);
  }, [data]);

  const logFollowUp = async () => {
    if (!data?.branch_id) {
      toast.error('This call has no branch attached, so a task cannot be created.');
      return;
    }
    setCreatingTask(true);
    try {
      await createTask({
        branchId: data.branch_id,
        title: `Follow up: ${data.member_name ?? 'Voice AI call'}`,
        description: `Voice AI call on ${fmt(data.started_at) ?? 'recent date'} — ${
          dispositionLook(data.disposition)?.label ?? statusLook(data.status).label
        }. ${data.next_step_agreed ?? data.reason_for_absence ?? ''}`.trim(),
        priority: 'high',
        slaHours: 24,
        linkedEntityType: data.member_id ? 'member' : undefined,
        linkedEntityId: data.member_id ?? undefined,
      });
      toast.success('Follow-up task created for the front desk.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the follow-up task.');
    } finally {
      setCreatingTask(false);
    }
  };

  if (!callId) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 p-10 text-center">
        <span className="rounded-full bg-indigo-50 p-3 text-indigo-600"><PhoneCall className="h-6 w-6" aria-hidden /></span>
        <p className="text-sm font-medium text-slate-900">Pick a call to review it</p>
        <p className="max-w-sm text-xs text-slate-500">
          You'll see the member, how the call went, the recording and the full transcript here.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="m-6 rounded-2xl bg-red-50 p-5 text-sm text-red-700">
        You do not have access to this call, or it could not be loaded.
      </div>
    );
  }

  const status = statusLook(data.status);
  const disposition = dispositionLook(data.disposition);

  return (
    <div className="space-y-5 p-5 md:p-6">
      {/* Caller header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold text-slate-900">{data.member_name ?? 'Unknown caller'}</h2>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {[data.member_code, data.masked_phone, data.branch_name].filter(Boolean).join(' · ') || '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {fmt(data.started_at) ?? '—'} · {formatDuration(data.duration_seconds)}
            {data.plan_name ? ` · ${data.plan_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className={`rounded-full ${status.className}`}>{status.label}</Badge>
          {disposition && <Badge className={`rounded-full ${disposition.className}`}>{disposition.label}</Badge>}
        </div>
      </div>

      {/* Recording */}
      <div className="rounded-2xl bg-slate-50 p-4">
        {data.can_view_transcript ? (
          <VoiceCallRecording callId={callId} />
        ) : (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Headphones className="h-4 w-4" aria-hidden />
            Recordings are limited to managers and above.
          </p>
        )}
      </div>

      {/* At a glance */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-700">
          <Sparkles className="h-4 w-4" aria-hidden /> Call at a glance
        </p>
        <ul className="mt-3 space-y-2">
          {highlights.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        {data.callback_datetime && (
          <p className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-700">
            <CalendarClock className="h-4 w-4" aria-hidden /> Callback due: {data.callback_datetime}
          </p>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={logFollowUp}
          disabled={creatingTask}
          className="min-h-[44px] cursor-pointer rounded-xl transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {creatingTask ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ClipboardList className="mr-2 h-4 w-4" aria-hidden />}
          Create follow-up task
        </Button>
        {data.member_id && (
          <Button asChild variant="outline" className="min-h-[44px] cursor-pointer rounded-xl">
            <Link to={`/members?focus=${data.member_id}`}>
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Open member
            </Link>
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => onOpenFullDetail(callId)}
          className="min-h-[44px] cursor-pointer rounded-xl"
        >
          Full call record
        </Button>
      </div>

      {/* Transcript */}
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
              {showTranscript ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
              Transcript ({turns.length})
            </Button>
            {showTranscript && (
              <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto rounded-2xl bg-slate-50 p-3">
                {turns.length === 0 && <p className="text-xs text-slate-500">No transcript was returned for this call.</p>}
                {turns.map((t, i) => (
                  <div key={i} className={`flex ${t.who === 'agent' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      t.who === 'agent' ? 'bg-white text-slate-900 shadow-sm' : 'bg-indigo-600 text-white'
                    }`}>
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                        {t.who === 'agent' ? 'Ananya (AI)' : 'Member'}
                      </p>
                      {t.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            Transcripts are limited to managers and above.
          </p>
        )}
      </div>
    </div>
  );
}

export default VoiceCallWorkspace;
