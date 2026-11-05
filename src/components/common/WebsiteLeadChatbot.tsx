import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, X, Minus, Send, Loader2, CheckCircle2, ExternalLink, RotateCcw, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { getFirstTouch, captureFirstTouch } from '@/lib/leads/firstTouch';
import { deriveLeadSource } from '@/lib/leads/sourceFromReferrer';
import {
  CHATBOT_GOALS, CHATBOT_TIMEFRAMES, WHATSAPP_HANDOFF_CONSENT, SAVED_NOTICE,
  type ChatbotTimeframe, normalizeIndianMobile, isValidEmail, buildWhatsAppDraft, buildWhatsAppUrl,
  newSubmissionId, timeframeLabel, firstName, BUSINESS_WHATSAPP,
} from '@/lib/leads/websiteChatbot';

type Step = 'goal' | 'timeframe' | 'contact' | 'note' | 'review' | 'done';
type Msg = { from: 'bot' | 'user'; text: string };
type Outcome = { kind: 'created' | 'existing' | 'already_member'; reference: string | null; channel: 'whatsapp' | 'callback' };

const WELCOME = 'Hi! Welcome to Incline. I can help you explore training, membership and recovery.';
const MAX_NOTE = 280;

async function readFnError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* not JSON */ }
  }
  return "We couldn't save your enquiry. Please check your connection and try again.";
}

export default function WebsiteLeadChatbot() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('goal');
  const [messages, setMessages] = useState<Msg[]>([{ from: 'bot', text: WELCOME }, { from: 'bot', text: "What's your main goal?" }]);
  const [typing, setTyping] = useState(false);
  const [goal, setGoal] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<ChatbotTimeframe | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState<null | 'whatsapp' | 'callback'>(null);
  const [submitError, setSubmitError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const submissionId = useRef(newSubmissionId());
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const consentId = useId();

  useEffect(() => { captureFirstTouch(); }, []);

  // Keep latest message visible and move focus into the current step's first control.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing, step]);
  useEffect(() => {
    if (!open || typing) return;
    const el = panelRef.current?.querySelector<HTMLElement>('[data-step-focus]');
    el?.focus();
  }, [open, step, typing]);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const advance = (userText: string, next: Step, botText?: string) => {
    setMessages((m) => [...m, { from: 'user', text: userText }]);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!botText) { setStep(next); return; }
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { from: 'bot', text: botText }]);
      setStep(next);
    }, reduce ? 0 : 450);
  };

  const pickGoal = (g: string) => { setGoal(g); advance(g, 'timeframe', 'Great choice. When would you like to start?'); };
  const pickTimeframe = (t: ChatbotTimeframe) => {
    setTimeframe(t);
    advance(timeframeLabel(t), 'contact', 'Lovely. What should we call you, and which WhatsApp / mobile number can the team use?');
  };

  const submitContact = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!normalizeIndianMobile(phone)) errs.phone = 'Enter a valid 10-digit Indian mobile number.';
    if (email.trim() && !isValidEmail(email)) errs.email = 'That email doesn\u2019t look right — or leave it blank.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    advance(`${name.trim()} · ${normalizeIndianMobile(phone)}`, 'note',
      `Thanks, ${firstName(name)}! Anything you'd like the team to know? A one-line question is perfect (optional). Please don't share medical details here.`);
  };

  const submitNote = (e: FormEvent) => {
    e.preventDefault();
    advance(note.trim() || 'No extra note', 'review', "Here's your enquiry. How would you like to continue?");
  };

  const save = async (channel: 'whatsapp' | 'callback') => {
    if (submitting) return; // duplicate-click guard
    if (channel === 'whatsapp' && !consent) { setSubmitError('Please tick the WhatsApp box to continue on WhatsApp.'); return; }
    setSubmitError('');
    setSubmitting(channel);
    // Open the tab synchronously inside the click so browsers don't block it.
    const tab = channel === 'whatsapp' ? window.open('', '_blank') : null;
    if (tab) { try { tab.opener = null; } catch { /* cross-origin */ } }

    const ft = getFirstTouch() || captureFirstTouch();
    const params = new URLSearchParams(window.location.search);
    const utmSource = ft?.utm_source || params.get('utm_source') || null;
    const referrer = ft?.referrer_url || document.referrer || null;
    try {
      const { data, error } = await supabase.functions.invoke('capture-lead', {
        body: {
          intake_type: 'website_chatbot',
          source: 'website_chatbot',
          first_touch_source: ft?.source || deriveLeadSource(utmSource || '', referrer || '', 'website'),
          fullName: name.trim(),
          phone: normalizeIndianMobile(phone),
          email: email.trim() || undefined,
          fitness_goal: goal,
          joining_timeframe: timeframe,
          notes: note.trim() || undefined,
          preferred_contact_channel: channel,
          submission_id: submissionId.current,
          company_website: hp,
          utm_source: utmSource,
          utm_medium: ft?.utm_medium || params.get('utm_medium') || null,
          utm_campaign: ft?.utm_campaign || params.get('utm_campaign') || null,
          utm_content: ft?.utm_content || params.get('utm_content') || null,
          utm_term: ft?.utm_term || params.get('utm_term') || null,
          landing_page: ft?.landing_page || window.location.href,
          referrer_url: referrer,
          consent: channel === 'whatsapp' ? { granted: true, channels: ['whatsapp'], text: WHATSAPP_HANDOFF_CONSENT } : null,
        },
      });
      if (error) throw error;
      const kind = (data?.status === 'already_member' ? 'already_member' : data?.status === 'existing' ? 'existing' : 'created') as Outcome['kind'];
      const reference = typeof data?.reference === 'string' ? data.reference : null;
      setOutcome({ kind, reference, channel });
      setStep('done');
      if (channel === 'whatsapp') {
        const url = buildWhatsAppUrl(kind === 'already_member'
          ? `Hi Incline! I'm ${firstName(name)}, an existing member. I have a question.`
          : buildWhatsAppDraft({ name, goal, timeframe, reference }));
        setWaUrl(url);
        if (tab && !tab.closed) tab.location.href = url;
        else setPopupBlocked(true);
      }
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      setSubmitError(await readFnError(err));
    } finally {
      setSubmitting(null);
    }
  };

  const restart = () => {
    setStep('goal'); setGoal(null); setTimeframe(null); setNote(''); setConsent(false); setOutcome(null);
    setWaUrl(null); setPopupBlocked(false); setSubmitError(''); submissionId.current = newSubmissionId();
    setMessages([{ from: 'bot', text: WELCOME }, { from: 'bot', text: "What's your main goal?" }]);
  };

  const chip = 'min-h-[44px] cursor-pointer rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="pointer-events-auto flex max-h-[min(640px,calc(100dvh-1.5rem))] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl sm:w-[380px]"
        >
          <header className="flex items-center gap-3 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15" aria-hidden="true">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-sm font-semibold leading-tight tracking-tight">Incline Concierge</h2>
              <p className="text-xs text-primary-foreground/75">A few quick questions, then WhatsApp</p>
            </div>
            <button type="button" onClick={close} aria-label="Minimise chat" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { restart(); close(); }} aria-label="Close chat and clear answers" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-muted/40 px-4 py-4" aria-live="polite" aria-relevant="additions">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.from === 'user' ? 'justify-end' : 'justify-start')}>
                <p className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  m.from === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card text-foreground')}>
                  <span className="sr-only">{m.from === 'user' ? 'You: ' : 'Incline: '}</span>{m.text}
                </p>
              </div>
            ))}
            {typing && (
              <div className="flex justify-start" aria-label="Incline is typing">
                <span className="flex gap-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-3">
                  {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" style={{ animationDelay: `${d * 120}ms` }} />)}
                </span>
              </div>
            )}

            {step === 'review' && !typing && (
              <dl className="rounded-xl border border-border bg-card p-3 text-sm">
                {[
                  ['Goal', goal], ['Joining', timeframeLabel(timeframe)], ['Name', name.trim()],
                  ['Mobile', normalizeIndianMobile(phone)], ['Email', email.trim() || '—'], ['Note', note.trim() || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3 py-0.5">
                    <dt className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {step === 'done' && outcome && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-3 text-sm" role="status">
                <p className="flex items-start gap-2 font-medium text-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {outcome.kind === 'already_member'
                    ? 'You\u2019re already an Incline member — our team is happy to help on WhatsApp.'
                    : outcome.channel === 'whatsapp' ? SAVED_NOTICE : 'Your enquiry is saved. Our team will call you back soon.'}
                </p>
                {outcome.reference && <p className="text-xs text-muted-foreground">Reference: <span className="font-mono">{outcome.reference}</span></p>}
                {waUrl && (
                  <div className="space-y-1">
                    {popupBlocked && <p className="text-xs text-muted-foreground">WhatsApp didn&apos;t open automatically. Use this link — your enquiry is still saved.</p>}
                    <a href={waUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-lg font-semibold text-primary underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Open WhatsApp draft <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                    <p className="text-xs text-muted-foreground">Nothing is sent until you press Send in WhatsApp.</p>
                  </div>
                )}
                {outcome.kind === 'already_member' && !waUrl && (
                  <a href={buildWhatsAppUrl(`Hi Incline! I'm ${firstName(name)}, an existing member. I have a question.`)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-2 font-semibold text-primary underline underline-offset-4">
                    Message us on WhatsApp <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card p-3">
            {step === 'goal' && !typing && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose your main goal">
                {CHATBOT_GOALS.map((g, i) => (
                  <button key={g} type="button" className={chip} onClick={() => pickGoal(g)} {...(i === 0 ? { 'data-step-focus': true } : {})}>{g}</button>
                ))}
              </div>
            )}
            {step === 'timeframe' && !typing && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="When would you like to start?">
                {CHATBOT_TIMEFRAMES.map((t, i) => (
                  <button key={t.value} type="button" className={chip} onClick={() => pickTimeframe(t.value)} {...(i === 0 ? { 'data-step-focus': true } : {})}>{t.label}</button>
                ))}
              </div>
            )}
            {step === 'contact' && !typing && (
              <form onSubmit={submitContact} noValidate className="space-y-2">
                <div>
                  <Label htmlFor="wcb-name" className="text-xs">Name</Label>
                  <Input id="wcb-name" data-step-focus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'wcb-name-err' : undefined} />
                  {errors.name && <p id="wcb-name-err" className="mt-1 text-xs text-destructive">{errors.name}</p>}
                </div>
                <div>
                  <Label htmlFor="wcb-phone" className="text-xs">WhatsApp / mobile number</Label>
                  <Input id="wcb-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} autoComplete="tel" placeholder="98XXXXXXXX" aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'wcb-phone-err' : undefined} />
                  {errors.phone && <p id="wcb-phone-err" className="mt-1 text-xs text-destructive">{errors.phone}</p>}
                </div>
                <div>
                  <Label htmlFor="wcb-email" className="text-xs">Email <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="wcb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'wcb-email-err' : undefined} />
                  {errors.email && <p id="wcb-email-err" className="mt-1 text-xs text-destructive">{errors.email}</p>}
                </div>
                {/* Honeypot — hidden from people and assistive tech */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label>Company website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
                </div>
                <Button type="submit" className="min-h-[44px] w-full">Continue</Button>
              </form>
            )}
            {step === 'note' && !typing && (
              <form onSubmit={submitNote} className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="wcb-note" className="sr-only">Optional question for the team</Label>
                  <Input id="wcb-note" data-step-focus value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))} maxLength={MAX_NOTE} placeholder="e.g. Do you have morning Pilates?" />
                </div>
                <Button type="submit" size="icon" className="h-11 w-11 shrink-0" aria-label={note.trim() ? 'Send note' : 'Skip note'}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            )}
            {step === 'review' && !typing && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-2">
                  <Checkbox id={consentId} data-step-focus checked={consent} onCheckedChange={(v) => { setConsent(v === true); setSubmitError(''); }} className="mt-0.5" />
                  <Label htmlFor={consentId} className="cursor-pointer text-xs font-normal leading-relaxed text-foreground">{WHATSAPP_HANDOFF_CONSENT}</Label>
                </div>
                <Button type="button" className="min-h-[44px] w-full" onClick={() => save('whatsapp')} disabled={!!submitting || !consent} aria-describedby={consentId}>
                  {submitting === 'whatsapp' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Save enquiry &amp; continue on WhatsApp
                </Button>
                <Button type="button" variant="outline" className="min-h-[44px] w-full" onClick={() => save('callback')} disabled={!!submitting}>
                  {submitting === 'callback' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <PhoneCall className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Save enquiry for a team callback
                </Button>
                {submitError && <p role="alert" className="text-xs text-destructive">{submitError}</p>}
              </div>
            )}
            {step === 'done' && (
              <Button type="button" variant="ghost" className="min-h-[44px] w-full" onClick={restart} data-step-focus>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Start a new enquiry
              </Button>
            )}
          </div>
        </div>
      ) : (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Chat with Incline"
          aria-haspopup="dialog"
          data-wa-number={BUSINESS_WHATSAPP}
          className="pointer-events-auto flex h-14 w-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-150 hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:w-auto sm:px-5"
        >
          <MessageCircle className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />
          <span className="hidden text-sm font-semibold sm:inline">Chat with Incline</span>
        </button>
      )}
    </div>
  );
}
