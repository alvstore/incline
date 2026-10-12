import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Copy, Eye, EyeOff, ExternalLink, Link2, Loader2 } from 'lucide-react';
import { ZOHO_STATUS_KEY, zohoAction, type ZohoStatus } from './zohoConnection';

const schema = z.object({
  client_id: z.string().trim().min(10, 'Paste the Client ID from Zoho'),
  client_secret: z.string().trim().optional(),
  dc: z.enum(['in', 'com', 'eu']),
  organization_id: z.string().trim().regex(/^(\d{5,20})?$/, 'Numbers only').optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props { open: boolean; onOpenChange: (o: boolean) => void; status?: ZohoStatus }

export function ZohoDirectSetupSheet({ open, onOpenChange, status }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showSecret, setShowSecret] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { client_id: '', client_secret: '', dc: 'in', organization_id: '' },
  });

  useEffect(() => {
    if (open) form.reset({ client_id: '', client_secret: '', dc: status?.dc ?? 'in', organization_id: status?.organization_id ?? '' });
  }, [open, status?.dc, status?.organization_id, form]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      if (!status?.has_client && !v.client_secret) throw new Error('Client Secret is required');
      await zohoAction({ action: 'save_credentials', client_id: v.client_id, client_secret: v.client_secret || undefined, dc: v.dc, organization_id: v.organization_id || '' });
      const { url } = await zohoAction<{ url: string }>({ action: 'start', origin: window.location.origin });
      return url;
    },
    onSuccess: (url) => {
      qc.invalidateQueries({ queryKey: ZOHO_STATUS_KEY });
      window.location.assign(url);
    },
    onError: (e: Error) => toast({ title: 'Could not save Zoho details', description: e.message, variant: 'destructive' }),
  });

  const copy = async () => {
    if (!status?.redirect_uri) return;
    await navigator.clipboard.writeText(status.redirect_uri);
    toast({ title: 'Redirect URL copied' });
  };

  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>Direct Zoho Books connection</SheetTitle>
          <SheetDescription>Connect with your own Zoho app. Your secret is stored on the server and is never shown again.</SheetDescription>
        </SheetHeader>
        <form id="zoho-direct-form" onSubmit={form.handleSubmit((v) => save.mutate(v))} className="flex-1 space-y-6 overflow-y-auto p-6">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Open{' '}
              <a href="https://api-console.zoho.in" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                Zoho API Console <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
              </a>{' '}and add a <strong>Server-based Application</strong>.
            </li>
            <li>Use this as the Authorized Redirect URL:</li>
          </ol>
          <div className="flex items-center gap-2 rounded-xl bg-muted p-3">
            <code className="flex-1 break-all text-xs text-foreground">{status?.redirect_uri ?? '…'}</code>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={copy} aria-label="Copy redirect URL">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">3. Paste the Client ID and Client Secret Zoho gives you below.</p>

          <div className="space-y-2">
            <Label htmlFor="zoho-client-id">Client ID</Label>
            <Input id="zoho-client-id" autoComplete="off" placeholder={status?.client_id_hint ?? '1000.XXXXXXXX'} aria-invalid={!!errors.client_id} aria-describedby={errors.client_id ? 'zoho-client-id-err' : undefined} {...form.register('client_id')} />
            {errors.client_id && <p id="zoho-client-id-err" role="alert" className="text-sm text-destructive">{errors.client_id.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="zoho-client-secret">Client Secret</Label>
            <div className="flex gap-2">
              <Input id="zoho-client-secret" type={showSecret ? 'text' : 'password'} autoComplete="off" placeholder={status?.has_client ? 'Leave blank to keep the saved secret' : ''} {...form.register('client_secret')} />
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => setShowSecret((s) => !s)} aria-label={showSecret ? 'Hide secret' : 'Show secret'} aria-pressed={showSecret}>
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="zoho-dc">Data centre</Label>
            <Select value={form.watch('dc')} onValueChange={(v) => form.setValue('dc', v as FormValues['dc'])}>
              <SelectTrigger id="zoho-dc" className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">India (zoho.in)</SelectItem>
                <SelectItem value="com">Global (zoho.com)</SelectItem>
                <SelectItem value="eu">Europe (zoho.eu)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="zoho-org">Organization ID <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="zoho-org" inputMode="numeric" aria-invalid={!!errors.organization_id} {...form.register('organization_id')} />
            {errors.organization_id && <p role="alert" className="text-sm text-destructive">{errors.organization_id.message}</p>}
          </div>
        </form>
        <SheetFooter className="border-t border-border p-6">
          <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="zoho-direct-form" className="h-11 gap-2" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {save.isPending ? 'Opening Zoho…' : 'Save & connect with Zoho'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
