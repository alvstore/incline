import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLockerPricing, useUpdateLockerPricing } from '@/hooks/useLockerPricing';
import { lockerPricing, LOCKER_SIZES } from '@/components/member/requests/requestTypes';
import { track } from '@/lib/analytics';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string;
}

export function LockerPricingSheet({ open, onOpenChange, branchId }: Props) {
  const { data, isLoading } = useLockerPricing(branchId);
  const save = useUpdateLockerPricing();
  const [medium, setMedium] = useState('2500');
  const [large, setLarge] = useState('3500');
  const [gstEnabled, setGstEnabled] = useState(true);
  const [gstRate, setGstRate] = useState('18');
  const [portal, setPortal] = useState(true);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!data || !open) return;
    setMedium(String(data.medium_fee));
    setLarge(String(data.large_fee));
    setGstEnabled(data.gst_enabled);
    setGstRate(String(data.gst_rate));
    setPortal(data.portal_requests_enabled);
    setNote(data.daily_use_note ?? '');
  }, [data, open]);

  const cfg = { medium_fee: Number(medium) || 0, large_fee: Number(large) || 0, gst_enabled: gstEnabled, gst_rate: Number(gstRate) || 0 };
  const invalid = Number(medium) < 0 || Number(large) < 0 || Number(gstRate) < 0 || Number(gstRate) > 28;

  const onSave = async () => {
    try {
      await save.mutateAsync({ branch_id: branchId, ...cfg, portal_requests_enabled: portal, daily_use_note: note });
      track('locker_pricing_updated', { gst_enabled: gstEnabled, portal_requests_enabled: portal });
      toast.success('Locker pricing saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save pricing');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>Locker pricing & GST</SheetTitle>
          <SheetDescription>
            Dedicated lockers last until the member's membership ends. Members see these prices when they request one.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lp-medium">Medium fee (₹, before GST)</Label>
                  <Input id="lp-medium" type="number" inputMode="numeric" min={0} value={medium} onChange={(e) => setMedium(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lp-large">Large fee (₹, before GST)</Label>
                  <Input id="lp-large" type="number" inputMode="numeric" min={0} value={large} onChange={(e) => setLarge(e.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <Label htmlFor="lp-gst" className="text-base">Charge GST</Label>
                  <p className="text-xs text-muted-foreground">Added on top of the fee on the bill</p>
                </div>
                <Switch id="lp-gst" checked={gstEnabled} onCheckedChange={setGstEnabled} />
              </div>
              {gstEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="lp-rate">GST rate (%)</Label>
                  <Input id="lp-rate" type="number" min={0} max={28} value={gstRate} onChange={(e) => setGstRate(e.target.value)} aria-invalid={invalid} />
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <Label htmlFor="lp-portal" className="text-base">Members can request from the app</Label>
                  <p className="text-xs text-muted-foreground">Turn off when no dedicated lockers are free</p>
                </div>
                <Switch id="lp-portal" checked={portal} onCheckedChange={setPortal} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lp-note">Note shown to members</Label>
                <Textarea id="lp-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Our standard gym lockers are free for temporary, daily use while you work out." />
              </div>

              <div className="rounded-xl bg-muted/50 p-4" aria-live="polite">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members will see</p>
                {LOCKER_SIZES.map((s) => {
                  const q = lockerPricing(s, cfg);
                  return (
                    <div key={s} className="flex justify-between text-sm tabular-nums">
                      <span>{s}</span>
                      <span>₹{q.base.toLocaleString('en-IN')}{q.gst ? ` + ₹${q.gst.toLocaleString('en-IN')} GST` : ''} = <strong>₹{q.total.toLocaleString('en-IN')}</strong></span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" onClick={onSave} disabled={save.isPending || invalid || isLoading}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
