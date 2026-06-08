import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Package, Edit2, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AddBenefitPackageDrawer } from './AddBenefitPackageDrawer';

interface BenefitPackagesPanelProps {
  branchId?: string;
}

export function BenefitPackagesPanel({ branchId }: BenefitPackagesPanelProps) {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['benefit-packages-admin', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('benefit_packages')
        .select('*, benefit_type_ref:benefit_types!benefit_packages_benefit_type_id_fkey(name, icon)')
        .eq('branch_id', branchId!)
        .order('display_order');
      if (error) throw error;
      return data || [];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from('benefit_packages').update({ is_active: value }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['benefit-packages-admin'] }),
    onError: (e: any) => toast.error(e.message || 'Toggle failed'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('benefit_packages').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Package removed');
      queryClient.invalidateQueries({ queryKey: ['benefit-packages-admin'] });
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Benefit Add-On Packages
          </h2>
          <p className="text-sm text-muted-foreground">Sell extra credits for sauna, ice bath, classes, and more.</p>
        </div>
        <Button onClick={() => { setEditing(null); setDrawerOpen(true); }} disabled={!branchId} className="gap-2 rounded-xl shadow-lg shadow-primary/10">
          <Plus className="h-4 w-4" /> New Package
        </Button>
      </div>

      {!branchId && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Pick a specific branch to manage add-on packages.</CardContent></Card>
      )}

      {branchId && isLoading && (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      )}

      {branchId && !isLoading && packages.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-1">No add-on packages yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create packs of sauna, ice-bath or class credits members can buy from their dashboard.</p>
            <Button onClick={() => { setEditing(null); setDrawerOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> Create First Package</Button>
          </CardContent>
        </Card>
      )}

      {branchId && !isLoading && packages.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {packages.map((p: any) => (
            <Card key={p.id} className={`rounded-2xl border-border/60 shadow-md transition-all ${!p.is_active ? 'opacity-60' : ''}`}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-base text-foreground">{p.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.benefit_type_ref?.name || p.benefit_type}</p>
                  </div>
                  <Switch checked={p.is_active} onCheckedChange={(v) => toggleActive.mutate({ id: p.id, value: v })} />
                </div>
                {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-primary/10 text-primary dark:text-primary border-primary/20">{p.quantity} credits</Badge>
                  <Badge variant="outline">{p.validity_days} days</Badge>
                  <Badge className="bg-success/10 text-success dark:text-success border-success/20">
                    ₹{Number(p.price).toLocaleString('en-IN')}{Number(p.tax_rate ?? 0) > 0 ? (p.tax_inclusive ? ' incl. GST' : ' + GST') : ''}
                  </Badge>
                  {Number(p.tax_rate ?? 0) > 0 && (
                    <Badge variant="outline" className="bg-warning/5 text-warning dark:text-warning border-warning/20">GST {Number(p.tax_rate)}%</Badge>
                  )}
                  {p.hsn_code && (
                    <Badge variant="outline" className="font-mono text-[10px]">HSN {p.hsn_code}</Badge>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setEditing(p); setDrawerOpen(true); }}>
                    <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive"
                    onClick={() => { if (confirm(`Delete "${p.name}"?`)) remove.mutate(p.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddBenefitPackageDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        branchId={branchId}
        initial={editing}
      />
    </div>
  );
}
