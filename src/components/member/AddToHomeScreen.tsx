import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'incline_a2hs_dismissed';

export function AddToHomeScreen() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || localStorage.getItem(KEY) === '1') return;
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios/i.test(ua);
    setIsIos(ios);
    if (ios) setHidden(false);
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); setHidden(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (hidden || (!isIos && !deferred)) return null;

  const dismiss = () => { localStorage.setItem(KEY, '1'); setHidden(true); };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setHidden(true);
    setDeferred(null);
  };

  return (
    <section className="lg:hidden relative rounded-2xl bg-card p-4 shadow-lg shadow-primary/10 border border-border">
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Add Incline to your home screen</p>
          {isIos ? (
            <ol className="mt-1 space-y-1 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">1. Tap <Share className="h-4 w-4 text-primary" /> Share in Safari</li>
              <li className="flex items-center gap-1.5">2. Choose <SquarePlus className="h-4 w-4 text-primary" /> Add to Home Screen</li>
            </ol>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Open Incline in one tap, full screen like an app.</p>
          )}
        </div>
      </div>
      {!isIos && (
        <Button onClick={install} className="mt-3 w-full min-h-11 gap-2"><Download className="h-4 w-4" />Add to Home Screen</Button>
      )}
    </section>
  );
}
