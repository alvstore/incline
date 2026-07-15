import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Rocket, ExternalLink, ShieldCheck, TriangleAlert } from 'lucide-react';

/**
 * Marketing Messages API (MM API) for WhatsApp toggle.
 *
 * When enabled, marketing template broadcasts are routed to the
 * `/{PHONE_NUMBER_ID}/marketing_messages` endpoint (formerly "MM Lite API",
 * now GA) which applies Meta's ML-based delivery optimization and reduces
 * 131049 ("not delivered to maintain ecosystem engagement") rate.
 *
 * Prerequisites (must be done by an admin in Meta):
 *   1. App Dashboard → WhatsApp → Quickstart → "Improve ROI with marketing
 *      messages with optimizations" → Get started → Accept ToS.
 *   2. At least one approved marketing template.
 *   3. Messages webhook subscribed (already configured).
 *
 * Utility / auth / service messages continue via Cloud API automatically —
 * MM API only accepts marketing templates.
 */
export function WhatsAppMarketingApiToggle() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations', 'whatsapp', 'mm-api'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integration_settings')
        .select('id, branch_id, config, is_active, provider')
        .eq('integration_type', 'whatsapp')
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const anyEnabled = integrations.some((i: any) => i.config?.mm_api_enabled === true);
  const acceptedAt = integrations.find((i: any) => i.config?.mm_api_tos_accepted_at)?.config
    ?.mm_api_tos_accepted_at as string | undefined;

  const setEnabled = async (enabled: boolean) => {
    if (!integrations.length) {
      toast.error('Configure a WhatsApp integration first');
      return;
    }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      await Promise.all(
        integrations.map(async (row: any) => {
          const nextConfig = {
            ...(row.config ?? {}),
            mm_api_enabled: enabled,
            ...(enabled && !row.config?.mm_api_tos_accepted_at
              ? { mm_api_tos_accepted_at: nowIso }
              : {}),
          };
          const { error } = await supabase
            .from('integration_settings')
            .update({ config: nextConfig })
            .eq('id', row.id);
          if (error) throw error;
        }),
      );
      toast.success(
        enabled
          ? 'Marketing Messages API enabled — promotional templates will route via MM API'
          : 'Marketing Messages API disabled — all sends will use Cloud API',
      );
      queryClient.invalidateQueries({ queryKey: ['integrations', 'whatsapp', 'mm-api'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update MM API setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-5 w-5 text-primary" />
          Marketing Messages API for WhatsApp
          {anyEnabled ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              <ShieldCheck className="mr-1 h-3 w-3" /> Enabled
            </Badge>
          ) : (
            <Badge variant="secondary">Not enabled</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Route promotional broadcasts through Meta's optimized delivery endpoint
          (formerly &ldquo;MM Lite API&rdquo;) to reduce error 131049 and improve read/click rates.
          Utility, auth, and service templates continue via Cloud API automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!integrations.length && !isLoading && (
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <TriangleAlert className="h-4 w-4 flex-shrink-0" />
            Configure a WhatsApp integration above before enabling Marketing Messages API.
          </div>
        )}

        <ol className="space-y-2 text-xs text-muted-foreground list-decimal pl-5">
          <li>
            Open Meta{' '}
            <a
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              App Dashboard <ExternalLink className="h-3 w-3" />
            </a>{' '}
            → WhatsApp → Quickstart.
          </li>
          <li>
            Find <span className="font-medium">&ldquo;Improve ROI with marketing messages with optimizations&rdquo;</span>{' '}
            → click <span className="font-medium">Get started</span> → accept the Terms of Service.
          </li>
          <li>Confirm at least one approved marketing template exists in Templates Hub.</li>
          <li>Toggle below to enable routing for future promotional broadcasts.</li>
        </ol>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">
              Send promotional broadcasts via Marketing Messages API
            </div>
            <div className="text-xs text-muted-foreground">
              {acceptedAt
                ? `ToS accepted ${new Date(acceptedAt).toLocaleDateString()}`
                : 'Enabling records the ToS acceptance timestamp'}
              {' · '}Applies to {integrations.length} WhatsApp integration
              {integrations.length === 1 ? '' : 's'}
            </div>
          </div>
          <Switch
            checked={anyEnabled}
            disabled={busy || isLoading || !integrations.length}
            onCheckedChange={setEnabled}
            aria-label="Enable Marketing Messages API routing"
          />
        </div>
      </CardContent>
    </Card>
  );
}
