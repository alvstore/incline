import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Receipt, Plus, X, BookOpenCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function TaxGstSettings() {
  const queryClient = useQueryClient();

  const { data: orgSettings, isLoading } = useQuery({
    queryKey: ['org-tax-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('id, gst_rates, hsn_defaults')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const currentRates = (orgSettings?.gst_rates as number[] | null) ?? [5, 12, 18, 28];
  const currentHsn = (orgSettings?.hsn_defaults as Record<string, string> | null) ?? {};

  const [rates, setRates] = useState<number[]>(currentRates);
  const [newRate, setNewRate] = useState('');
  const [hsnDefaults, setHsnDefaults] = useState<Record<string, string>>(currentHsn);
  const [initialized, setInitialized] = useState(false);

  if (orgSettings && !initialized) {
    setRates((orgSettings.gst_rates as number[]) ?? [5, 12, 18, 28]);
    setHsnDefaults((orgSettings.hsn_defaults as Record<string, string>) ?? {});
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgSettings?.id) return;
      const { error } = await supabase
        .from('organization_settings')
        .update({ gst_rates: rates, hsn_defaults: hsnDefaults })
        .eq('id', orgSettings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Tax settings saved');
      queryClient.invalidateQueries({ queryKey: ['org-tax-settings'] });
      queryClient.invalidateQueries({ queryKey: ['org-gst-rates'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const addRate = () => {
    const rate = parseFloat(newRate);
    if (!rate || rate <= 0 || rate > 100) {
      toast.error('Enter a valid rate between 0 and 100');
      return;
    }
    if (rates.includes(rate)) {
      toast.error('Rate already exists');
      return;
    }
    setRates([...rates, rate].sort((a, b) => a - b));
    setNewRate('');
  };

  const removeRate = (rate: number) => {
    setRates(rates.filter(r => r !== rate));
  };

  const HSN_CATEGORIES = [
    { key: 'membership', label: 'Memberships' },
    { key: 'pt_package', label: 'PT Packages' },
    { key: 'product', label: 'Products / POS' },
    { key: 'benefit', label: 'Benefits (Sauna, Ice Bath, etc.)' },
  ];

  return (
    <div className="space-y-6">
      <Link to="/finance?tab=gst" className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        Zoho Books connection is managed in Finance → GST. Open it to connect directly or check status.
      </Link>
      <div>
        <h2 className="text-lg font-semibold">Tax & GST Settings</h2>
        <p className="text-sm text-muted-foreground">Configure GST rate slabs and HSN/SAC codes for invoicing</p>
      </div>

      {/* GST Rate Slabs */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <CardTitle>GST Rate Slabs</CardTitle>
          </div>
          <CardDescription>Configure available GST rates for invoices and memberships</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {rates.map(rate => (
              <Badge key={rate} variant="secondary" className="text-sm px-3 py-1.5 gap-2">
                {rate}%
                <button onClick={() => removeRate(rate)} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
              placeholder="Add rate (e.g., 6)"
              className="max-w-[200px]"
              onKeyDown={e => e.key === 'Enter' && addRate()}
            />
            <Button variant="outline" size="icon" onClick={addRate}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* HSN/SAC Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>HSN / SAC Codes</CardTitle>
          <CardDescription>Set default HSN/SAC codes per category. These will pre-fill on new invoices.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {HSN_CATEGORIES.map(cat => (
              <div key={cat.key} className="space-y-1.5">
                <Label>{cat.label}</Label>
                <Input
                  placeholder="e.g., 99714"
                  value={hsnDefaults[cat.key] || ''}
                  onChange={e => setHsnDefaults({ ...hsnDefaults, [cat.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Common HSN codes: 99714 (gym/fitness services), 99713 (recreation), 99722 (dietary consulting)
          </p>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !orgSettings?.id}>
        {saveMutation.isPending ? 'Saving...' : 'Save Tax Settings'}
      </Button>
    </div>
  );
}
