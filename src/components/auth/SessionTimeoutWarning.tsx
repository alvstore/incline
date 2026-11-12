import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Clock, X } from 'lucide-react';
import { useState } from 'react';

export function SessionTimeoutWarning() {
  const { showTimeoutWarning, sessionExpiresIn, extendSession } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!showTimeoutWarning || dismissed) return null;

  const minutes = Math.max(1, Math.ceil((sessionExpiresIn || 0) / 60000));

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-3 bg-warning/10 border border-warning/30 text-warning-foreground rounded-xl px-4 py-3 shadow-lg backdrop-blur-sm max-w-sm">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-warning/20 flex items-center justify-center">
          <Clock className="h-4 w-4 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Session expiring</p>
          <p className="text-xs text-muted-foreground">
            Your session expires in {minutes} minute{minutes !== 1 ? 's' : ''}.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0 h-8 text-xs border-warning/30 hover:bg-warning/10"
          onClick={() => {
            extendSession();
            setDismissed(true);
            // Re-enable after a bit in case user is still idle
            setTimeout(() => setDismissed(false), 60000);
          }}
        >
          Stay Signed In
        </Button>
        <button type="button"
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
