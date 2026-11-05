import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, X, Minus, Send, Loader2, Phone, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { getFirstTouch, captureFirstTouch } from '@/lib/leads/firstTouch';
import {
  EMAIL_REQUIRED_COPY, ESCALATION_TEL, ESCALATION_PHONE,
  type ConciergeState, type Topic, type BotMessage,
  normalizeIndianMobile, isValidEmail, newSubmissionId, firstName,
  conciergeReply, extractName, extractEmail, extractMobile, isQuestionLike, isDirectQuestion, intakeAside, matchIntent, matchGoal, matchDuration,
} from '@/lib/leads/websiteChatbot';

type Step = 'form' | 'saving' | 'chat' | 'handoff';
/** Registered members/trainers/staff only — leads never see a WhatsApp link. */
const MEMBER_WHATSAPP = 'https://wa.me/918298293003?text=Menu';
const INTENTS = ['Membership', 'Personal training', 'Recovery & wellness', 'Group classes & Pilates', 'Just exploring'] as const;
const DURATIONS = ['Monthly', 'Quarterly', 'Half-Yearly', 'Annual'] as const;
const GOALS = ['Fat loss', 'Build muscle', 'General fitness', 'Recovery & wellness', 'Athletic performance'] as const;
const STAGES = ['Your details', 'Saving', 'Concierge'] as const;
const stageOf = (s: Step) => (s === 'chat' || s === 'handoff' ? 2 : s === 'saving' ? 1 : 0);
type FormErrors = Partial<Record<'name' | 'phone' | 'email' | 'intent' | 'duration' | 'goal', string>>;
type Msg = { from: 'bot' | 'user'; text: string; tel?: boolean; url?: string };
/** Only gateway payment links may be rendered as a link. */
const safePayUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\/(rzp\.io|razorpay\.me|pages\.razorpay\.com)\//.test(u) ? u : undefined);
type SaveResult = { status?: string; lead_id?: string; reference?: string };

const WELCOME = 'Hi! Welcome to Incline. I can help you explore training, membership and recovery.';
const FIRST_Q = 'Share a few quick details below and I will answer anything about plans, prices, training and recovery.';
const MAX_NOTE = 280;
const STORE_KEY = 'incline-web-chat-v2';
type Saved = { step: Step; messages: Msg[]; name: string; email: string; phone: string; intent: string; goal: string; interest: string; leadId: string | null; submissionId: string; concierge: Partial<ConciergeState> };
function loadSaved(): Saved | null {
  try { const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORE_KEY) : null; if (!raw) return null; const v = JSON.parse(raw) as Saved & { at?: number }; const ok = ['form','chat','handoff'].includes(v?.step) && Array.isArray(v?.messages) && (!v.at || Date.now() - v.at < 7 * 864e5); return ok ? v : null; } catch { return null; }
}

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

const PROMPTS: Partial<Record<Step, { label: string; placeholder: string; type: string; autoComplete: string; inputMode?: 'tel' | 'email' | 'text' }>> = {
  chat: { label: 'Ask a question', placeholder: 'Ask about prices, plans, facilities, visits…', type: 'text', autoComplete: 'off' },
};

export default function WebsiteLeadChatbot() {
  const saved = useRef(loadSaved()).current;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(saved?.step ?? 'form');
  const [messages, setMessages] = useState<Msg[]>(saved?.messages?.length ? saved.messages : [{ from: 'bot', text: WELCOME }, { from: 'bot', text: FIRST_Q }]);
  const [typing, setTyping] = useState(false);
  const [interest, setInterest] = useState(saved?.interest ?? '');
  const [name, setName] = useState(saved?.name ?? '');
  const [email, setEmail] = useState(saved?.email ?? '');
  const [phone, setPhone] = useState(saved?.phone ?? '');
  const [intent, setIntent] = useState(saved?.intent ?? '');
  const [goal, setGoal] = useState(saved?.goal ?? '');
  const [draft, setDraft] = useState('');
  const [duration, setDuration] = useState('');
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [hp, setHp] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [leadId, setLeadId] = useState<string | null>(saved?.leadId ?? null);
  const [concierge, setConcierge] = useState<ConciergeState>({ discountAsks: 0, awaitingVisit: false, plans: [], ...(saved?.concierge ?? {}) });
  const topics = useRef<Set<Topic>>(new Set());
  const submissionId = useRef(saved?.submissionId || newSubmissionId());
  const inFlight = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errId = useId();

  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { captureFirstTouch(); }, []);
  // Remember the conversation so refresh / close / reopen never loses it.
  useEffect(() => {
    try {
      const data: Saved & { at: number } = { at: Date.now(), step, messages: messages.slice(-80), name, email, phone, intent, goal, interest, leadId, submissionId: submissionId.current,
        concierge: { discountAsks: concierge.discountAsks, awaitingVisit: concierge.awaitingVisit, offeredVisit: concierge.offeredVisit, isMember: concierge.isMember, lastTopic: concierge.lastTopic, visitOffers: concierge.visitOffers, declinedVisit: concierge.declinedVisit } };
      window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch { /* storage unavailable */ }
  }, [step, messages, name, email, phone, intent, goal, interest, leadId, concierge]);

  // Active plan names only (server returns no prices); grounded categories always available.
  const plansQuery = useQuery({
    queryKey: ['website-chatbot-plans'],
    enabled: open,
    select: undefined,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('capture-lead', { body: { intake_type: 'website_chatbot', action: 'plans' } });
      if (error) throw error;
      const str = (a: unknown) => (Array.isArray(a) ? a : []).filter((p: unknown): p is string => typeof p === 'string');
      return { plans: str(data?.plans), prices: str(data?.prices) };
    },
  });
  const plans: string[] = plansQuery.data?.plans ?? [];
  const prices: string[] = plansQuery.data?.prices ?? [];
  useEffect(() => { setConcierge((c) => ({ ...c, plans, prices })); }, [plans.join('|'), prices.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, typing, step]);
  useEffect(() => {
    if (!open || typing) return;
    panelRef.current?.querySelector<HTMLElement>('[data-step-focus]')?.focus();
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

  const botSay = (msgs: BotMessage[], next?: Step) => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, ...msgs.map((b) => ({ from: 'bot' as const, ...b }))]);
      if (next) setStep(next);
    }, reduce ? 0 : 400);
  };
  const userSay = (text: string) => setMessages((m) => [...m, { from: 'user', text }]);

  const saveMutation = useMutation({
    retry: false, // visitor retries explicitly; never double-submit silently
    mutationFn: async (): Promise<SaveResult> => {
      const ft = getFirstTouch() || captureFirstTouch();
      const params = new URLSearchParams(window.location.search);
      const { data, error } = await supabase.functions.invoke('capture-lead', {
        body: {
          intake_type: 'website_chatbot',
          source: 'website_chatbot',
          fullName: name.trim(),
          email: email.trim(),
          phone: normalizeIndianMobile(phone),
          plan_interest: interest,
          fitness_goal: goal || undefined,
          notes: intent ? `Enquiry type: ${intent}${goal ? ` · Goal: ${goal}` : ''}` : undefined,
          submission_id: submissionId.current,
          company_website: hp,
          utm_source: ft?.utm_source || params.get('utm_source') || null,
          utm_medium: ft?.utm_medium || params.get('utm_medium') || null,
          utm_campaign: ft?.utm_campaign || params.get('utm_campaign') || null,
          utm_content: ft?.utm_content || params.get('utm_content') || null,
          utm_term: ft?.utm_term || params.get('utm_term') || null,
          landing_page: ft?.landing_page || window.location.href,
          referrer_url: ft?.referrer_url || document.referrer || null,
        },
      });
      if (error) throw error;
      return (data ?? {}) as SaveResult;
    },
  });

  const visitMutation = useMutation({
    retry: false,
    mutationFn: async (visit: string) => {
      if (!leadId) return;
      const { error } = await supabase.functions.invoke('capture-lead', {
        body: { intake_type: 'website_chatbot', action: 'visit_preference', lead_id: leadId, submission_id: submissionId.current, visit_preference: visit, topics: [...topics.current] },
      });
      if (error) throw error;
    },
  });

  const save = async () => {
    if (inFlight.current) return; // duplicate-click guard
    inFlight.current = true;
    setSaveError('');
    setStep('saving');
    try {
      const data = await saveMutation.mutateAsync();
      if (data.status === 'already_member') {
        // Members, trainers and staff are not served by this lead chat: they use the
        // WhatsApp self-service concierge (plan, PT, classes, recovery, gate pass) or call the desk.
        botSay([
          { text: `Welcome back, ${firstName(name)}! This chat is for new enquiries, and your number is already registered with Incline.` },
          { text: `For your plan, PT sessions, classes, recovery bookings or gate pass, message our WhatsApp concierge or call us on ${ESCALATION_PHONE}.` },
        ], 'handoff');
        setConcierge((c) => ({ ...c, isMember: true }));
      } else {
        setLeadId(data.lead_id ?? null);
        const welcome = [
          { text: `Thanks ${firstName(name)}! I've noted your interest in ${interest.toLowerCase()}${goal ? ` with a focus on ${goal.toLowerCase()}` : ''}.` },
          { text: 'Ask me anything, like prices, plan inclusions, recovery, trainers or planning a visit.' },
        ];
        botSay(welcome, 'chat');
        if (data.lead_id) {
          // Copy the conversation so far into the team's chat inbox (best effort).
          const transcript = [...messagesRef.current, ...welcome.map((w) => ({ from: 'bot' as const, text: w.text }))]
            .slice(-40).map((m) => ({ from: m.from, text: m.text.slice(0, 600) }));
          void supabase.functions.invoke('capture-lead', {
            body: { intake_type: 'website_chatbot', action: 'sync_transcript', lead_id: data.lead_id, submission_id: submissionId.current, messages: transcript },
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      setSaveError(await readFnError(err));
      setStep('form');
    } finally {
      inFlight.current = false;
    }
  };


  const runConcierge = (reply: ReturnType<typeof conciergeReply>) => {
    topics.current.add(reply.topic);
    setConcierge(reply.state);
    botSay(reply.messages);
    if (reply.visitPreference) visitMutation.mutate(reply.visitPreference);
  };

  /** Saved enquiries: answer from the shared knowledge base and log both sides to the team inbox.
   *  Falls back to the built-in answers if the network fails, so the visitor is never stuck. */
  const askServer = async (input: { message?: string; topic?: Topic; label?: string }, fallback: () => ReturnType<typeof conciergeReply>) => {
    if (!leadId) return runConcierge(fallback());
    setTyping(true);
    try {
      const { data, error } = await supabase.functions.invoke('capture-lead', {
        body: {
          intake_type: 'website_chatbot', action: 'chat', lead_id: leadId, submission_id: submissionId.current,
          state: { discountAsks: concierge.discountAsks, awaitingVisit: concierge.awaitingVisit, offeredVisit: concierge.offeredVisit === true, lastTopic: concierge.lastTopic, visitOffers: concierge.visitOffers ?? 0, declinedVisit: concierge.declinedVisit === true, quote: concierge.quote ?? {} }, ...input,
        },
      });
      if (error || !Array.isArray(data?.messages)) throw error ?? new Error('bad reply');
      topics.current.add(data.topic as Topic);
      setConcierge((c) => ({ ...c, discountAsks: Number(data.state?.discountAsks) || 0, awaitingVisit: data.state?.awaitingVisit === true, offeredVisit: data.state?.offeredVisit === true, lastTopic: data.state?.lastTopic as Topic | undefined, visitOffers: Number(data.state?.visitOffers) || 0, declinedVisit: data.state?.declinedVisit === true, quote: (data.state?.quote && typeof data.state.quote === 'object') ? data.state.quote as Record<string, unknown> : {} }));
      setTyping(false);
      setMessages((m) => [...m, ...(data.messages as BotMessage[]).map((b) => ({ from: 'bot' as const, text: String(b.text), tel: b.tel === true, url: safePayUrl((b as { url?: unknown }).url) }))]);
    } catch {
      setTyping(false);
      runConcierge(fallback());
    }
  };


  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    const errs: FormErrors = {};
    const n = name.trim();
    if (n.length < 2 || !/^[\p{L} .'-]+$/u.test(n)) errs.name = 'Please enter your full name (letters only).';
    if (!normalizeIndianMobile(phone)) errs.phone = 'Enter a valid 10-digit Indian mobile number.';
    if (!email.trim()) errs.email = `Email is required. ${EMAIL_REQUIRED_COPY}`;
    else if (!isValidEmail(email.trim())) errs.email = 'Please enter a valid email, like name@example.com.';
    if (!intent) errs.intent = 'Please choose what you are looking for.';
    if (intent === 'Membership' && !duration) errs.duration = 'Please choose a membership duration.';
    if (!goal) errs.goal = 'Please choose your main goal.';
    setFormErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus());
      return;
    }
    setName(n); setEmail(email.trim());
    const chosen = intent === 'Membership' ? `${duration} membership` : intent;
    setInterest(chosen);
    userSay(`${n} · ${chosen} · ${goal}`);
    pendingSave.current = true;
  };
  const pendingSave = useRef(false);
  useEffect(() => { if (pendingSave.current && interest) { pendingSave.current = false; void save(); } }, [interest]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    setFieldError('');
    if (!v) return;
    if (step === 'chat') {
      userSay(v); setDraft('');
      void askServer({ message: v }, () => conciergeReply(v, concierge));
    }
  };

  const restart = () => {
    setStep('form'); setInterest(''); setName(''); setEmail(''); setPhone(''); setIntent(''); setGoal(''); setDuration('');
    setDraft(''); setFieldError(''); setSaveError(''); setLeadId(null); topics.current = new Set();
    setConcierge((c) => ({ ...c, discountAsks: 0, awaitingVisit: false, offeredVisit: false, isMember: false, lastTopic: undefined, visitOffers: 0, declinedVisit: false, quote: {} }));
    submissionId.current = newSubmissionId();
    setMessages([{ from: 'bot', text: WELCOME }, { from: 'bot', text: FIRST_Q }]); setFormErrors({});
    try { window.localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  };

  const chip = 'min-h-[44px] cursor-pointer rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const prompt = PROMPTS[step];
  const stage = stageOf(step);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
      {open ? (
        <div ref={panelRef} role="dialog" aria-modal="false" aria-labelledby={titleId}
          className="pointer-events-auto flex max-h-[min(660px,calc(100dvh-1.5rem))] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl sm:w-[390px]">
          <header className="flex items-center gap-3 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15" aria-hidden="true">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-sm font-semibold leading-tight tracking-tight">Incline Concierge</h2>
              <p className="text-xs text-primary-foreground/75">Facilities, membership and visits</p>
            </div>
            <button type="button" onClick={close} aria-label="Minimise chat" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" onClick={close} aria-label="Close chat" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground">
              <X className="h-4 w-4" />
            </button>
          </header>
          <ol className="flex items-center gap-2 border-b border-border bg-card px-4 py-2" aria-label="Progress">
            {STAGES.map((s, i) => (
              <li key={s} className="flex flex-1 flex-col gap-1" aria-current={i === stage ? 'step' : undefined}>
                <span className={cn('h-1 rounded-full transition-colors duration-300', i <= stage ? 'bg-accent' : 'bg-muted')} />
                <span className={cn('text-[11px] font-medium', i === stage ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
              </li>
            ))}
          </ol>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-muted/40 px-4 py-4" aria-live="polite" aria-relevant="additions">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.from === 'user' ? 'justify-end' : 'justify-start')}>
                <p className={cn('max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  m.from === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card text-foreground')}>
                  <span className="sr-only">{m.from === 'user' ? 'You: ' : 'Incline: '}</span>{m.text}
                  {m.url && (
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-[44px] items-center gap-2 font-semibold text-primary underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <CreditCard className="h-4 w-4" aria-hidden="true" /> Pay securely
                    </a>
                  )}
                  {m.tel && (
                    <a href={ESCALATION_TEL} className="mt-2 flex min-h-[44px] items-center gap-2 font-semibold text-primary underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <Phone className="h-4 w-4" aria-hidden="true" /> Call {ESCALATION_PHONE}
                    </a>
                  )}
                </p>
              </div>
            ))}
            {(typing || step === 'saving') && (
              <div className="flex justify-start" aria-label={step === 'saving' ? 'Saving your enquiry' : 'Incline is typing'}>
                <span className="flex gap-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-3">
                  {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" style={{ animationDelay: `${d * 120}ms` }} />)}
                </span>
              </div>
            )}
            {step === 'form' && !typing && (
              <form onSubmit={submitForm} noValidate aria-label="Your details" className="space-y-3 rounded-2xl border border-border bg-card p-4">
                {([
                  ['name', 'Full name', 'text', 'name', name, setName, 'Your full name', undefined],
                  ['phone', 'Mobile number', 'tel', 'tel', phone, setPhone, '98XXXXXXXX', 'tel'],
                  ['email', 'Email address', 'email', 'email', email, setEmail, 'you@example.com', 'email'],
                ] as const).map(([key, label, type, ac, val, set, ph, im]) => (
                  <div key={key} className="space-y-1">
                    <label htmlFor={`wcb-${key}`} className="text-xs font-semibold text-foreground">{label} <span className="text-destructive" aria-hidden="true">*</span></label>
                    <Input id={`wcb-${key}`} data-field={key} {...(key === 'name' ? { 'data-step-focus': true } : {})} value={val} type={type} autoComplete={ac} inputMode={im} placeholder={ph}
                      maxLength={key === 'email' ? 255 : 100} aria-required="true" aria-invalid={!!formErrors[key]}
                      aria-describedby={formErrors[key] ? `wcb-${key}-err` : undefined}
                      onChange={(e) => { set(e.target.value); setFormErrors((f) => ({ ...f, [key]: undefined })); }} />
                    {formErrors[key] && <p id={`wcb-${key}-err`} className="text-xs text-destructive">{formErrors[key]}</p>}
                  </div>
                ))}
                {([
                  ['intent', 'What are you looking for?', INTENTS, intent, (v: string) => { setIntent(v); if (v !== 'Membership') setDuration(''); }],
                  ...(intent === 'Membership' ? [['duration', 'Membership duration', DURATIONS, duration, setDuration] as const] : []),
                  ['goal', 'Your main fitness goal', GOALS, goal, setGoal],
                ] as const).map(([key, label, opts, val, set]) => (
                  <fieldset key={key} className="space-y-1.5" aria-describedby={formErrors[key] ? `wcb-${key}-err` : undefined}>
                    <legend className="text-xs font-semibold text-foreground">{label} <span className="text-destructive" aria-hidden="true">*</span></legend>
                    <div className="flex flex-wrap gap-2">
                      {opts.map((o, i) => (
                        <button key={o} type="button" aria-pressed={val === o} {...(i === 0 ? { 'data-field': key } : {})}
                          onClick={() => { set(o); setFormErrors((f) => ({ ...f, [key]: undefined })); }}
                          className={cn(chip, 'min-h-[40px] px-3 py-1.5 text-xs', val === o && 'border-primary bg-primary text-primary-foreground hover:bg-primary')}>{o}</button>
                      ))}
                    </div>
                    {formErrors[key] && <p id={`wcb-${key}-err`} className="text-xs text-destructive">{formErrors[key]}</p>}
                  </fieldset>
                ))}
                {saveError && (
                  <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">{saveError}</p>
                )}
                <Button type="submit" className="min-h-[44px] w-full">{saveError ? 'Try again' : 'Start chatting'}</Button>
                <p className="text-[11px] text-muted-foreground">We use these details only to help with your enquiry.</p>
              </form>
            )}
          </div>

          <div className="space-y-2 border-t border-border bg-card p-3">
            {prompt && !typing && (
              <form onSubmit={submitText} noValidate className="flex items-start gap-2">
                <div className="flex-1">
                  <label htmlFor="wcb-input" className="sr-only">{prompt.label}</label>
                  <Input id="wcb-input" data-step-focus value={draft} onChange={(e) => { setDraft(e.target.value); setFieldError(''); }}
                    type={prompt.type} inputMode={prompt.inputMode} autoComplete={prompt.autoComplete} placeholder={prompt.placeholder}
                    maxLength={MAX_NOTE}
                    aria-invalid={!!fieldError} aria-describedby={fieldError ? errId : undefined} />
                  {fieldError && <p id={errId} role="alert" className="mt-1 text-xs text-destructive">{fieldError}</p>}
                </div>
                <Button type="submit" size="icon" className="h-11 w-11 shrink-0" aria-label="Send">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            )}
            {/* Honeypot — hidden from people and assistive tech */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Company website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
            </div>
            {step === 'handoff' && (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Contact Incline">
                <a data-step-focus href={MEMBER_WHATSAPP} target="_blank" rel="noopener noreferrer"
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                </a>
                <a href={ESCALATION_TEL}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Phone className="h-4 w-4" aria-hidden="true" /> Call
                </a>
              </div>
            )}
            {(step === 'chat' || step === 'handoff') && (
              <button type="button" onClick={restart} className="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-xs text-muted-foreground hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Start a new enquiry
              </button>
            )}
          </div>
        </div>
      ) : (
        <button ref={launcherRef} type="button" onClick={() => setOpen(true)} aria-label="Chat with Incline" aria-haspopup="dialog"
          className="pointer-events-auto flex h-14 w-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-150 hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none sm:w-auto sm:px-5">
          <MessageCircle className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />
          <span className="hidden text-sm font-semibold sm:inline">Chat with Incline</span>
        </button>
      )}
    </div>
  );
}
