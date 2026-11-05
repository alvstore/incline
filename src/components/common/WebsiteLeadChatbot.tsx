import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, X, Minus, Send, Loader2, Phone, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { getFirstTouch, captureFirstTouch } from '@/lib/leads/firstTouch';
import {
  INTEREST_CATEGORIES, EMAIL_REQUIRED_COPY, FOLLOW_UPS, ESCALATION_TEL, ESCALATION_PHONE,
  type ConciergeState, type Topic, type BotMessage,
  normalizeIndianMobile, isValidEmail, newSubmissionId, firstName,
  conciergeReply, conciergeTopic, welcomeAfterCapture,
} from '@/lib/leads/websiteChatbot';

type Step = 'name' | 'phone' | 'email' | 'intent' | 'interest' | 'goal' | 'saving' | 'chat';
const INTENTS = ['Membership', 'Personal training', 'Recovery (sauna, steam, cold plunge)', 'Pilates / group classes', 'Just looking'] as const;
const GOALS = ['Fat loss', 'Build muscle', 'General fitness', 'Recovery & wellness', 'Personal training'] as const;
type Msg = { from: 'bot' | 'user'; text: string; tel?: boolean };
type SaveResult = { status?: string; lead_id?: string; reference?: string };

const WELCOME = 'Hi! Welcome to Incline. I can help you explore training, membership and recovery.';
const FIRST_Q = 'To get started, may I have your full name?';
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

const PROMPTS: Partial<Record<Step, { label: string; placeholder: string; type: string; autoComplete: string; inputMode?: 'tel' | 'email' | 'text' }>> = {
  name: { label: 'Your full name', placeholder: 'Full name', type: 'text', autoComplete: 'name' },
  email: { label: 'Your email address (required)', placeholder: 'you@example.com', type: 'email', autoComplete: 'email', inputMode: 'email' },
  phone: { label: 'Your mobile number', placeholder: '98XXXXXXXX', type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
  chat: { label: 'Ask a question', placeholder: 'Ask about facilities, membership, visits…', type: 'text', autoComplete: 'off' },
};

export default function WebsiteLeadChatbot() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('name');
  const [messages, setMessages] = useState<Msg[]>([{ from: 'bot', text: WELCOME }, { from: 'bot', text: FIRST_Q }]);
  const [typing, setTyping] = useState(false);
  const [interest, setInterest] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [intent, setIntent] = useState('');
  const [goal, setGoal] = useState('');
  const [draft, setDraft] = useState('');
  const [hp, setHp] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [leadId, setLeadId] = useState<string | null>(null);
  const [concierge, setConcierge] = useState<ConciergeState>({ discountAsks: 0, awaitingVisit: false, plans: [] });
  const topics = useRef<Set<Topic>>(new Set());
  const submissionId = useRef(newSubmissionId());
  const inFlight = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errId = useId();

  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { captureFirstTouch(); }, []);

  // Active plan names only (server returns no prices); grounded categories always available.
  const plansQuery = useQuery({
    queryKey: ['website-chatbot-plans'],
    enabled: open,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('capture-lead', { body: { intake_type: 'website_chatbot', action: 'plans' } });
      if (error) throw error;
      return (Array.isArray(data?.plans) ? data.plans : []).filter((p: unknown): p is string => typeof p === 'string');
    },
  });
  const plans: string[] = plansQuery.data ?? [];
  useEffect(() => { setConcierge((c) => ({ ...c, plans })); }, [plans.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

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
        botSay([
          { text: `Welcome back, ${firstName(name)}! You're already an Incline member, so we haven't created a new enquiry.` },
          { text: 'I can still answer questions about the club here.' },
        ], 'chat');
      } else {
        setLeadId(data.lead_id ?? null);
        const welcome = [...welcomeAfterCapture(name, interest).map((text) => ({ text })), { text: 'What would you like to know first?' }];
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
      setStep('goal');
    } finally {
      inFlight.current = false;
    }
  };

  const pickIntent = (v: string) => { setIntent(v); userSay(v); botSay([{ text: 'Which plan or service interests you most?' }], 'interest'); };
  const pickInterest = (v: string) => { setInterest(v); userSay(v); botSay([{ text: 'Great choice. What is your main fitness goal?' }], 'goal'); };
  const pickGoal = (v: string) => { setGoal(v); userSay(v); };
  useEffect(() => { if (goal && step === 'goal' && !saveError && !inFlight.current && !leadId) void save(); }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

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
          state: { discountAsks: concierge.discountAsks, awaitingVisit: concierge.awaitingVisit }, ...input,
        },
      });
      if (error || !Array.isArray(data?.messages)) throw error ?? new Error('bad reply');
      topics.current.add(data.topic as Topic);
      setConcierge((c) => ({ ...c, discountAsks: Number(data.state?.discountAsks) || 0, awaitingVisit: data.state?.awaitingVisit === true }));
      setTyping(false);
      setMessages((m) => [...m, ...(data.messages as BotMessage[]).map((b) => ({ from: 'bot' as const, text: String(b.text), tel: b.tel === true }))]);
    } catch {
      setTyping(false);
      runConcierge(fallback());
    }
  };
  const pickTopic = (label: string, topic: Topic) => { userSay(label); void askServer({ topic, label }, () => conciergeTopic(topic, concierge)); };

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    setFieldError('');
    if (step === 'name') {
      if (v.length < 2) return setFieldError('Please enter your full name.');
      setName(v); userSay(v); setDraft('');
      botSay([{ text: `Thanks, ${firstName(v)}. What's your mobile number?` }], 'phone');
    } else if (step === 'email') {
      if (!v) return setFieldError(`Email is required. ${EMAIL_REQUIRED_COPY}`);
      if (!isValidEmail(v)) return setFieldError('Please enter a valid email address, like name@example.com.');
      setEmail(v); userSay(v); setDraft('');
      botSay([{ text: 'What are you looking for today?' }], 'intent');
    } else if (step === 'phone') {
      const n = normalizeIndianMobile(v);
      if (!n) return setFieldError('Enter a valid 10-digit Indian mobile number.');
      setPhone(n); userSay(n); setDraft('');
      botSay([{ text: "And your email address?" }, { text: EMAIL_REQUIRED_COPY }], 'email');
    } else if (step === 'chat') {
      if (!v) return;
      userSay(v); setDraft('');
      void askServer({ message: v }, () => conciergeReply(v, concierge));
    }
  };

  const restart = () => {
    setStep('name'); setInterest(''); setName(''); setEmail(''); setPhone(''); setIntent(''); setGoal('');
    setDraft(''); setFieldError(''); setSaveError(''); setLeadId(null); topics.current = new Set();
    setConcierge((c) => ({ ...c, discountAsks: 0, awaitingVisit: false }));
    submissionId.current = newSubmissionId();
    setMessages([{ from: 'bot', text: WELCOME }, { from: 'bot', text: FIRST_Q }]);
  };

  const chip = 'min-h-[44px] cursor-pointer rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const prompt = PROMPTS[step];
  const interestOptions = Array.from(new Set([...plans, ...INTEREST_CATEGORIES]));

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
          </div>

          <div className="space-y-2 border-t border-border bg-card p-3">
            {step === 'interest' && !typing && (
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto" role="group" aria-label="What are you interested in?">
                {plansQuery.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading options" />}
                {interestOptions.map((v, i) => (
                  <button key={v} type="button" className={chip} onClick={() => pickInterest(v)} {...(i === 0 ? { 'data-step-focus': true } : {})}>{v}</button>
                ))}
              </div>
            )}
            {step === 'intent' && !typing && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="What are you looking for?">
                {INTENTS.map((t, i) => (
                  <button key={t} type="button" className={chip} onClick={() => pickIntent(t)} {...(i === 0 ? { 'data-step-focus': true } : {})}>{t}</button>
                ))}
              </div>
            )}
            {step === 'goal' && !typing && !saveError && !goal && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="What is your main fitness goal?">
                {GOALS.map((t, i) => (
                  <button key={t} type="button" className={chip} onClick={() => pickGoal(t)} {...(i === 0 ? { 'data-step-focus': true } : {})}>{t}</button>
                ))}
              </div>
            )}
            {step === 'chat' && !typing && (
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Suggested questions">
                {FOLLOW_UPS.map((f) => (
                  <button key={f.topic} type="button" className={cn(chip, 'shrink-0')} onClick={() => pickTopic(f.label, f.topic)}>{f.label}</button>
                ))}
              </div>
            )}
            {saveError && step === 'goal' && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                <p>{saveError}</p>
                <Button type="button" size="sm" variant="outline" className="min-h-[44px]" onClick={() => void save()}>Try again</Button>
              </div>
            )}
            {prompt && !typing && (
              <form onSubmit={submitText} noValidate className="flex items-start gap-2">
                <div className="flex-1">
                  <label htmlFor="wcb-input" className="sr-only">{prompt.label}</label>
                  <Input id="wcb-input" data-step-focus value={draft} onChange={(e) => { setDraft(e.target.value); setFieldError(''); }}
                    type={prompt.type} inputMode={prompt.inputMode} autoComplete={prompt.autoComplete} placeholder={prompt.placeholder}
                    maxLength={step === 'email' ? 255 : step === 'phone' ? 16 : step === 'name' ? 100 : MAX_NOTE}
                    required={step === 'email' || step === 'name' || step === 'phone'}
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
            {step === 'chat' && (
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
