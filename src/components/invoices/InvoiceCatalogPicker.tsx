import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2 } from 'lucide-react';

export interface CatalogItem {
  key: string;
  name: string;
  price: number;
  group: string;
  gstRate?: number | null;
}

interface Props {
  branchId: string;
  onPick: (item: CatalogItem) => void;
  placeholder?: string;
}

const groupClass: Record<string, string> = {
  'Add-on / Facility': 'bg-emerald-100 text-emerald-700',
  'PT Package': 'bg-indigo-100 text-indigo-700',
  Membership: 'bg-violet-100 text-violet-700',
  Product: 'bg-amber-100 text-amber-700',
};

export function InvoiceCatalogPicker({ branchId, onPick, placeholder = 'Search sauna, ice bath, PT package, product…' }: Props) {
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);

  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ['invoice-catalog', branchId],
    enabled: !!branchId,
    staleTime: 60_000,
    queryFn: async (): Promise<CatalogItem[]> => {
      const scope = <T extends { branch_id: string | null }>(rows: T[]) =>
        rows.filter((r) => !r.branch_id || r.branch_id === branchId);

      const [benefits, pt, plans, products] = await Promise.all([
        supabase.from('benefit_packages').select('id, name, price, branch_id, tax_rate, is_active').eq('is_active', true),
        supabase.from('pt_packages').select('id, name, price, branch_id, gst_percentage, is_active').eq('is_active', true),
        supabase.from('membership_plans').select('id, name, price, branch_id, gst_rate, is_active').eq('is_active', true),
        supabase.from('products').select('id, name, price, branch_id, tax_rate, is_active').eq('is_active', true),
      ]);

      const out: CatalogItem[] = [];
      scope((benefits.data as any[]) || []).forEach((r: any) =>
        out.push({ key: `b-${r.id}`, name: r.name, price: Number(r.price || 0), group: 'Add-on / Facility', gstRate: r.tax_rate }),
      );
      scope((pt.data as any[]) || []).forEach((r: any) =>
        out.push({ key: `p-${r.id}`, name: r.name, price: Number(r.price || 0), group: 'PT Package', gstRate: r.gst_percentage }),
      );
      scope((plans.data as any[]) || []).forEach((r: any) =>
        out.push({ key: `m-${r.id}`, name: r.name, price: Number(r.price || 0), group: 'Membership', gstRate: r.gst_rate }),
      );
      scope((products.data as any[]) || []).forEach((r: any) =>
        out.push({ key: `s-${r.id}`, name: r.name, price: Number(r.price || 0), group: 'Product', gstRate: r.tax_rate }),
      );
      return out;
    },
  });

  const results = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = t ? catalog.filter((c) => c.name?.toLowerCase().includes(t)) : catalog;
    return list.slice(0, 12);
  }, [catalog, term]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <Input
        aria-label="Search catalog items"
        placeholder={placeholder}
        value={term}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
        className="pl-10"
      />
      {focused && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border bg-background shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
            </div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-slate-500 text-center">No matching items — type a custom description instead.</div>
          ) : (
            results.map((item) => (
              <button
                key={item.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(item);
                  setTerm('');
                  setFocused(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex items-center justify-between gap-2 border-b last:border-b-0 cursor-pointer focus:outline-none focus:bg-slate-50"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Badge className={`${groupClass[item.group] || 'bg-slate-100 text-slate-600'} rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0`}>
                    {item.group}
                  </Badge>
                  <span className="truncate font-medium text-slate-900">{item.name}</span>
                </span>
                <span className="text-xs font-semibold text-slate-700 shrink-0">₹{item.price.toLocaleString('en-IN')}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
