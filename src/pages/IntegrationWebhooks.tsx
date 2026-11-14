import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRef } from 'react';
import { SplitTitle, usePageEntrance } from '@/components/motion/pageMotion';
import { WebhookActivityPanel } from '@/components/integrations/WebhookActivityPanel';

export default function IntegrationWebhooks() {
  const scope = useRef<HTMLDivElement>(null);
  usePageEntrance(scope);
  return (
    <AppLayout>
      <div ref={scope} className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-xl mt-1">
              <Link to="/integrations" aria-label="Back to integrations">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-7 w-7 text-primary" aria-hidden="true" />
                <SplitTitle text="Webhook Activity" className="text-3xl font-bold tracking-tight" />
              </div>
              <p className="text-muted-foreground mt-1">
                Every payment webhook delivery, signature verification, and HTTP outcome.
              </p>
            </div>
          </div>
        </div>

        <div data-anim="card"><WebhookActivityPanel /></div>
      </div>
    </AppLayout>
  );
}
