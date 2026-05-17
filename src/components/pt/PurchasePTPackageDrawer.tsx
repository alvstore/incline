import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Dumbbell, CalendarDays, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { computePtCheckout, formatINR } from '@/lib/payments/ptCheckout';

type Mode = 'session' | 'monthly';

interface PurchasePTPackageDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  branchId: string;
}

interface CatalogPkg {
  id: string;
  name: string;
  description: string | null;
  total_sessions: number | null;
  duration_months: number | null;
  validity_days: number | null;
  price: number;
  gst_percentage: number | null;
  gst_inclusive: boolean | null;
  package_type: 'session_based' | 'monthly';
}

interface CustomForm {
  name: string;
  sessions: number;
  validityMonths: number;
  durationMonths: number;
  price: number;
  gstPct: number;
}

export function PurchasePTPackageDrawer({
  open, onOpenChange, memberId, branchId,
}: PurchasePTPackageDrawerProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('session');
  const [selected, setSelected] = useState<string | 'custom' | null>(null);
  const [custom, setCustom] = useState<CustomForm>({
    name: '',
    sessions: 12,
    validityMonths: 3,
    durationMonths: 1,
    price: 0,
    gstPct: 18,
  });

  // Reset selection when mode flips so stale state can't carry over
  useEffect(() => { setSelected(null); }, [mode]);
  useEffect(() => {
    if (!open) { setMode('session'); setSelected(null); }
  }, [open]);

  const dbType = mode === 'session' ? 'session_based' : 'monthly';

  const { data: packages = [], isLoading } = useQuery<CatalogPkg[]>({
    queryKey: ['pt-packages-active', branchId, dbType],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pt_packages')
        .select('id, name, description, total_sessions, duration_months, validity_days, price, gst_percentage, gst_inclusive, package_type')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .eq('package_type', dbType as any)
        .order('price', { ascending: true });
      if (error) throw error;
      return (data as any) ?? [];
    },
  });

  const selectedPkg = useMemo(
    () => packages.find(p => p.id === selected) ?? null,
    [packages, selected],
  );

  // Live checkout math
  const checkoutInput = useMemo(() => {
    if (selected === 'custom') {
      return { price: custom.price, gstPct: custom.gstPct, gstInclusive: false };
    }
    if (selectedPkg) {
      return {
        price: Number(selectedPkg.price) || 0,
        gstPct: Number(selectedPkg.gst_percentage ?? 18),
        gstInclusive: !!selectedPkg.gst_inclusive,
      };
    }
    return { price: 0, gstPct: 18, gstInclusive: false };
  }, [selected, selectedPkg, custom]);

  const breakdown = computePtCheckout(checkoutInput);

  const purchase = useMutation({
    mutationFn: async () => {
      let packageId: string | null = null;

      if (selected === 'custom') {
        if (!custom.name.trim()) throw new Error('Give the custom pack a name');
        if (custom.price <= 0) throw new Error('Enter a price');
        if (mode === 'session' && custom.sessions <= 0) throw new Error('Sessions must be > 0');
        if (mode === 'monthly' && custom.durationMonths <= 0) throw new Error('Duration must be > 0');

        const validityDays = mode === 'session'
          ? Math.max(1, custom.validityMonths) * 30
          : Math.max(1, custom.durationMonths) * 30;

        const insert = {
          branch_id: branchId,
          name: custom.name.trim(),
          description: 'Custom PT pack',
          package_type: dbType,
          total_sessions: mode === 'session' ? custom.sessions : null,
          duration_months: mode === 'monthly' ? custom.durationMonths : null,
          validity_days: validityDays,
          price: custom.price,
          gst_percentage: custom.gstPct,
          gst_inclusive: false,
          is_active: false,
        };
        const { data, error } = await supabase
          .from('pt_packages').insert(insert as any)
          .select('id').single();
        if (error) throw error;
        packageId = data.id;
      } else if (selectedPkg) {
        packageId = selectedPkg.id;
      } else {
        throw new Error('Pick a package first');
      }

      const { data: rpc, error: rpcErr } = await supabase.rpc(
        'purchase_pt_package',
        {
          p_member_id: memberId,
          p_package_id: packageId!,
          p_branch_id: branchId,
          p_payment_source: 'payment_link',
        } as any,
      );
      if (rpcErr) throw rpcErr;
      return rpc as any;
    },
    onSuccess: (data: any) => {
      const invoiceId = data?.invoice_id;
      toast.success('PT package ready · redirecting to payment');
      queryClient.invalidateQueries({ queryKey: ['my-pt-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['member-pt-packages'] });
      onOpenChange(false);
      if (invoiceId) navigate(`/member/pay?invoice=${invoiceId}`);
    },
    onError: (e: any) => toast.error(e?.message || 'Could not start checkout'),
  });

  const canCharge =
    !purchase.isPending &&
    ((selected && selected !== 'custom') ||
      (selected === 'custom' &&
        custom.name.trim().length > 0 &&
        custom.price > 0 &&
        (mode === 'session' ? custom.sessions > 0 : custom.durationMonths > 0)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5" /> Purchase PT Package
          </SheetTitle>
          <SheetDescription>
            Pick a preset pack or build a custom one — staff sees live GST and total before charging.
          </SheetDescription>
        </SheetHeader>

        {/* Segmented control */}
        <div className="px-6 pt-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full bg-slate-100 p-1 rounded-xl">
              <TabsTrigger
                value="session"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <Dumbbell className="h-4 w-4 mr-2" /> Session Pack
              </TabsTrigger>
              <TabsTrigger
                value="monthly"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                <CalendarDays className="h-4 w-4 mr-2" /> Monthly Plan
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Scrollable catalog + custom card */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {packages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No preset {mode === 'session' ? 'session packs' : 'monthly plans'} — build a custom one below.
                </p>
              )}

              {packages.map((pkg) => {
                const isSel = selected === pkg.id;
                return (
                  <Card
                    key={pkg.id}
                    onClick={() => setSelected(pkg.id)}
                    className={`cursor-pointer rounded-2xl border-0 shadow-sm transition-all ${
                      isSel
                        ? 'ring-2 ring-primary shadow-md shadow-primary/10'
                        : 'hover:shadow-md'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold truncate">{pkg.name}</h4>
                            {isSel && <Check className="h-4 w-4 text-primary shrink-0" />}
                          </div>
                          {pkg.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {pkg.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {mode === 'session' && pkg.total_sessions != null && (
                              <Badge variant="secondary" className="text-xs">
                                {pkg.total_sessions} sessions
                              </Badge>
                            )}
                            {mode === 'monthly' && pkg.duration_months != null && (
                              <Badge variant="secondary" className="text-xs">
                                {pkg.duration_months} month{pkg.duration_months > 1 ? 's' : ''}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              Valid {pkg.validity_days} days
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              GST {pkg.gst_percentage ?? 18}%
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-lg font-bold">
                            ₹{Number(pkg.price).toLocaleString('en-IN')}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Custom builder */}
              <Card
                onClick={() => selected !== 'custom' && setSelected('custom')}
                className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all ${
                  selected === 'custom'
                    ? 'border-primary bg-primary/5'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Plus className="h-4 w-4" />
                    Build a custom {mode === 'session' ? 'session pack' : 'monthly plan'}
                  </div>

                  {selected === 'custom' && (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="custom-name" className="text-xs">Pack name</Label>
                        <Input
                          id="custom-name"
                          value={custom.name}
                          onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                          placeholder={mode === 'session' ? '12 PT Sessions — Custom' : 'Monthly PT — Custom'}
                        />
                      </div>

                      {/* Sessions input is physically removed in Monthly mode */}
                      {mode === 'session' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-sessions" className="text-xs">Number of sessions</Label>
                            <Input
                              id="custom-sessions"
                              type="number" min={1}
                              value={custom.sessions}
                              onChange={(e) =>
                                setCustom({ ...custom, sessions: parseInt(e.target.value) || 0 })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-validity" className="text-xs">Validity (months)</Label>
                            <Input
                              id="custom-validity"
                              type="number" min={1}
                              value={custom.validityMonths}
                              onChange={(e) =>
                                setCustom({ ...custom, validityMonths: parseInt(e.target.value) || 0 })
                              }
                            />
                          </div>
                        </div>
                      )}

                      {mode === 'monthly' && (
                        <div className="space-y-1.5">
                          <Label htmlFor="custom-duration" className="text-xs">Duration (months)</Label>
                          <Input
                            id="custom-duration"
                            type="number" min={1}
                            value={custom.durationMonths}
                            onChange={(e) =>
                              setCustom({ ...custom, durationMonths: parseInt(e.target.value) || 0 })
                            }
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="custom-price" className="text-xs">Price (₹)</Label>
                          <Input
                            id="custom-price"
                            type="number" min={0}
                            value={custom.price}
                            onChange={(e) =>
                              setCustom({ ...custom, price: parseFloat(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="custom-gst" className="text-xs">GST %</Label>
                          <Input
                            id="custom-gst"
                            type="number" min={0} max={50}
                            value={custom.gstPct}
                            onChange={(e) =>
                              setCustom({ ...custom, gstPct: parseFloat(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Sticky checkout bar */}
        <div className="border-t bg-white/95 backdrop-blur px-6 py-4 space-y-2">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Subtotal</span>
            <span>{formatINR(breakdown.subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>GST ({breakdown.gstPct}%){breakdown.gstInclusive ? ' · incl.' : ''}</span>
            <span>{formatINR(breakdown.tax)}</span>
          </div>
          <div className="flex justify-between text-base font-bold pt-1 border-t border-dashed border-slate-200">
            <span>Final Total</span>
            <span>{formatINR(breakdown.total)}</span>
          </div>
          <Button
            className="w-full mt-2"
            size="lg"
            disabled={!canCharge}
            onClick={() => purchase.mutate()}
          >
            {purchase.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <>Charge & Assign · {formatINR(breakdown.total)}</>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
