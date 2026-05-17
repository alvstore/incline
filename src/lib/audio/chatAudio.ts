// Single source of truth for chat notification sounds.
//
// All inbound chat events from realtime subscriptions should route through
// `notifyInbound(...)` — this hook gates on user preference, debounces bursts,
// and chooses an appropriate sound based on focus + active conversation:
//
//   • tab hidden / unfocused                       → full ping
//   • focused, different conversation              → softer ping
//   • focused, same conversation already open      → barely-audible pop
//   • internal note / disabled / debounced         → silent
//
// Do NOT call playPing directly from feature code. Call notifyInbound and let
// this module decide. The legacy `playPing` export is kept only for the
// Settings "Test sound" button via `playTest()`.

const STORAGE_KEY = 'incline:chat-sound-enabled';

export function isChatSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === null ? true : v === 'true';
}

export function setChatSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('chat-sound-pref-change'));
}

// ─── Internal state ──────────────────────────────────────────────────────────

let activeConversationKey: string | null = null;
let lastPlayedAt = 0;
const DEBOUNCE_MS = 250;

let sharedCtx: AudioContext | null = null;
let gestureUnlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!sharedCtx) sharedCtx = new AC();
    if (sharedCtx.state === 'suspended' && gestureUnlocked) {
      sharedCtx.resume().catch(() => {});
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

// Unlock on first user gesture so subsequent realtime-driven sounds can play.
if (typeof window !== 'undefined') {
  const unlock = () => {
    gestureUnlocked = true;
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

// ─── Tones ───────────────────────────────────────────────────────────────────

function tone(opts: {
  startFreq: number;
  endFreq?: number;
  durationMs: number;
  gain: number;
  type?: OscillatorType;
}) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const now = ctx.currentTime;
    const durS = opts.durationMs / 1000;
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.startFreq, now);
    if (opts.endFreq && opts.endFreq !== opts.startFreq) {
      osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + durS * 0.5);
    }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(opts.gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durS);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durS + 0.05);
  } catch {
    // ignore
  }
}

/** Loud ping for unfocused / different-conversation inbound. */
export function playPing(gain = 0.18) {
  tone({ startFreq: 880, endFreq: 1320, durationMs: 320, gain });
}

/** Soft acknowledgement for inbound on the conversation already open. */
export function playPop() {
  tone({ startFreq: 520, durationMs: 80, gain: 0.04 });
}

/** Settings "Test sound" button — always plays, ignores active-chat gating. */
export function playTest() {
  playPing(0.18);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function setActiveConversation(key: string | null) {
  activeConversationKey = key;
}

export function getActiveConversation(): string | null {
  return activeConversationKey;
}

export interface InboundNotice {
  conversationKey: string | null;
  isInternalNote?: boolean;
}

export function notifyInbound({ conversationKey, isInternalNote }: InboundNotice) {
  if (isInternalNote) return;
  if (typeof window === 'undefined') return;
  if (!isChatSoundEnabled()) return;

  const now = Date.now();
  if (now - lastPlayedAt < DEBOUNCE_MS) return;
  lastPlayedAt = now;

  const focused =
    typeof document !== 'undefined' &&
    !document.hidden &&
    document.hasFocus();

  if (!focused) {
    playPing(0.18);
    return;
  }
  if (conversationKey && conversationKey === activeConversationKey) {
    playPop();
    return;
  }
  // Focused but on a different conversation/page — softer ping.
  playPing(0.10);
}
