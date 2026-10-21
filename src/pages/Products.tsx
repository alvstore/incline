import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddProductDrawer } from '@/components/products/AddProductDrawer';
import { ProductBatchesTab } from '@/components/products/ProductBatchesTab';
import { AddBatchDrawer } from '@/components/products/AddBatchDrawer';
import { ImportPurchaseBillDrawer } from '@/components/products/ImportPurchaseBillDrawer';
import { ProductsToActivate } from '@/components/products/ProductsToActivate';
import { AdjustStockDrawer } from '@/components/products/AdjustStockDrawer';
import { StockHistoryTab } from '@/components/products/StockHistoryTab';
import { ManageCategoriesDrawer } from '@/components/products/ManageCategoriesDrawer';
import { ManageOptionsDrawer } from '@/components/products/ManageOptionsDrawer';
import {
  Plus, Package, AlertTriangle, TrendingUp, Search, MoreHorizontal, Pencil, Trash2,
  Image as ImageIcon, Archive, Layers, ShieldCheck, FileSpreadsheet, Sparkles, History,
  SlidersHorizontal, Store, CheckCircle2, XCircle, CircleDashed, Tags,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { toast } from 'sonner';
import { setSellable } from '@/services/inventoryService';
import { marginPercent, posBlocker, posState, stockStatus, type StockStatus } from '@/lib/products/productRules';
import type { Tables } from '@/integrations/supabase/types';

type ProductRow = Tables<'products'> & { product_categories: { id: string; name: string } | null };
type InventoryRow = Pick<Tables<'inventory'>, 'id' | 'product_id' | 'branch_id' | 'quantity' | 'min_quantity' | 'last_restocked_at'>;

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STOCK_BADGE: Record<StockStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: 'In stock', className: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20', Icon: CheckCircle2 },
  low: { label: 'Low stock', className: 'bg-amber-500/10 text-amber-500 border border-amber-500/20', Icon: AlertTriangle },
  out: { label: 'Out of stock', className: 'bg-destructive/10 text-destructive border border-destructive/20', Icon: XCircle },
  untracked: { label: 'Not counted', className: 'bg-muted text-muted-foreground border border-border', Icon: CircleDashed },
};

function StockBadge({ status }: { status: StockStatus }) {
  const { label, className, Icon } = STOCK_BADGE[status];
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const { branchFilter, branches, currentBranchName } = useBranchContext();
  const stockBranchId = branchFilter ?? (branches.length === 1 ? branches[0].id : undefined);
  const stockBranchName = branchFilter ? currentBranchName ?? undefined : branches.length === 1 ? branches[0].name : undefined;

  const [importOpen, setImportOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [batchesProduct, setBatchesProduct] = useState<ProductRow | null>(null);
  const [addBatchProduct, setAddBatchProduct] = useState<ProductRow | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<ProductRow | null>(null);
  const [optionsParent, setOptionsParent] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('products');

  const productsQ = useQuery({
    queryKey: ['products', branchFilter],
    queryFn: async () => {
      let q = supabase.from('products').select('*, product_categories(id, name)').eq('is_active', true).eq('is_variant_parent', false).order('name');
      if (branchFilter) q = q.or(`branch_id.is.null,branch_id.eq.${branchFilter}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ProductRow[];
    },
  });

  const inventoryQ = useQuery({
    queryKey: ['inventory', branchFilter],
    queryFn: async () => {
      let q = supabase.from('inventory').select('id, product_id, branch_id, quantity, min_quantity, last_restocked_at');
      if (branchFilter) q = q.eq('branch_id', branchFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InventoryRow[];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_categories').select('id, name').eq('is_active', true).order('name');
      if (error) throw error;
      return data;
    },
  });

  const products = productsQ.data ?? [];

  // product_id → stock (summed across branches when viewing all branches)
  const stockByProduct = useMemo(() => {
    const m = new Map<string, { qty: number; min: number; last: string | null }>();
    for (const r of inventoryQ.data ?? []) {
      const cur = m.get(r.product_id);
      if (cur) {
        cur.qty += r.quantity ?? 0;
        cur.min += r.min_quantity ?? 5;
        if (r.last_restocked_at && (!cur.last || r.last_restocked_at > cur.last)) cur.last = r.last_restocked_at;
      } else {
        m.set(r.product_id, { qty: r.quantity ?? 0, min: r.min_quantity ?? 5, last: r.last_restocked_at });
      }
    }
    return m;
  }, [inventoryQ.data]);

  const statusOf = (p: ProductRow): StockStatus => {
    const s = stockByProduct.get(p.id);
    return s ? stockStatus(s.qty, s.min) : stockStatus(null, null);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').update({ is_active: false, is_sellable: false }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success('Product removed from the catalog');
      ['products', 'inventory', 'pos-products', 'products-to-activate'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error('Could not delete product', { description: e.message }),
  });

  const sellableMutation = useMutation({
    mutationFn: ({ id, sellable }: { id: string; sellable: boolean }) => setSellable(id, sellable),
    onMutate: async ({ id, sellable }) => {
      await queryClient.cancelQueries({ queryKey: ['products', branchFilter] });
      const prev = queryClient.getQueryData<ProductRow[]>(['products', branchFilter]);
      queryClient.setQueryData<ProductRow[]>(['products', branchFilter], (old) =>
        old?.map((p) => (p.id === id ? { ...p, is_sellable: sellable } : p)),
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['products', branchFilter], ctx.prev);
      toast.error('Could not change POS status', { description: e.message });
    },
    onSuccess: (_d, v) => toast.success(v.sellable ? 'Now selling on POS & member store' : 'Hidden from POS & member store'),
    onSettled: () => {
      ['products', 'pos-products', 'products-to-activate'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
  });

  const term = searchTerm.trim().toLowerCase();
  const filtered = products.filter((p) => {
    const matchesSearch = !term || p.name.toLowerCase().includes(term) || (p.sku ?? '').toLowerCase().includes(term);
    const matchesCategory = categoryFilter === 'all' || p.category_id === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  const filteredStock = filtered.filter((p) => {
    const st = statusOf(p);
    return stockFilter === 'all' || (stockFilter === 'low' && (st === 'low' || st === 'out')) || (stockFilter === 'in-stock' && st === 'ok') || (stockFilter === 'untracked' && st === 'untracked');
  });

  const lowCount = products.filter((p) => ['low', 'out'].includes(statusOf(p))).length;
  const liveCount = products.filter((p) => p.is_sellable).length;
  const setupCount = products.filter((p) => !p.is_sellable).length;
  const stockValue = products.reduce((sum, p) => sum + (stockByProduct.get(p.id)?.qty ?? 0) * Number(p.cost_price ?? 0), 0);

  const openEdit = (p: ProductRow) => { setEditingProduct(p); setDrawerOpen(true); };
  const openAdd = () => { setEditingProduct(null); setDrawerOpen(true); };

  const isLoading = productsQ.isLoading || inventoryQ.isLoading;
  const isError = productsQ.isError || inventoryQ.isError;

  const PosCell = ({ p }: { p: ProductRow }) => {
    const state = posState(p);
    if (state === 'needs_setup') {
      return (
        <Button variant="outline" size="sm" className="h-8" onClick={() => setActiveTab('activate')} title={posBlocker(p) ?? ''}>
          <Sparkles className="h-3.5 w-3.5 mr-1" aria-hidden /> Set up
        </Button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={!!p.is_sellable}
          onCheckedChange={(v) => sellableMutation.mutate({ id: p.id, sellable: v })}
          aria-label={`${p.is_sellable ? 'Stop selling' : 'Sell'} ${p.name} on POS`}
        />
        <span className="text-xs text-muted-foreground">{p.is_sellable ? 'Live' : 'Hidden'}</span>
      </div>
    );
  };

  const RowActions = ({ p }: { p: ProductRow }) => (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setAdjustProduct(p)} aria-label={`Adjust stock for ${p.name}`} title="Adjust stock">
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {p.parent_product_id && (
        <Button variant="outline" size="sm" className="h-9" onClick={() => setOptionsParent(p.parent_product_id as string)} aria-label={`Manage options for ${p.name}`}>
          <Layers className="h-4 w-4 mr-1" aria-hidden />Options
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
        <Pencil className="h-4 w-4" aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`More actions for ${p.name}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(p)}><Pencil className="h-4 w-4 mr-2" aria-hidden />Edit details</DropdownMenuItem>
          {p.parent_product_id && (
            <DropdownMenuItem onClick={() => setOptionsParent(p.parent_product_id as string)}><Layers className="h-4 w-4 mr-2" aria-hidden />Manage options</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setAdjustProduct(p)}><SlidersHorizontal className="h-4 w-4 mr-2" aria-hidden />Adjust stock</DropdownMenuItem>
          {p.requires_batch_tracking && (
            <>
              <DropdownMenuItem onClick={() => setAddBatchProduct(p)}><Plus className="h-4 w-4 mr-2" aria-hidden />Receive batch</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBatchesProduct(p)}><Layers className="h-4 w-4 mr-2" aria-hidden />View batches</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(p)}>
            <Trash2 className="h-4 w-4 mr-2" aria-hidden />Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const ProductCell = ({ p }: { p: ProductRow }) => (
    <button type="button" onClick={() => openEdit(p)} className="flex items-center gap-3 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="h-11 w-11 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="font-medium text-foreground">{p.name}</p>
          {p.requires_batch_tracking && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 rounded-full text-[10px] px-2 py-0">
              <Layers className="h-3 w-3 mr-1" aria-hidden />Batch
            </Badge>
          )}
          {p.requires_lab_report && (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 rounded-full text-[10px] px-2 py-0">
              <ShieldCheck className="h-3 w-3 mr-1" aria-hidden />CoA
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono">{p.sku || p.hsn_code ? `${p.sku ?? ''}${p.sku && p.hsn_code ? ' · ' : ''}${p.hsn_code ? `HSN ${p.hsn_code}` : ''}` : 'No SKU'}</p>
      </div>
    </button>
  );

  const TableState = ({ cols }: { cols: number }) =>
    isLoading ? (
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <TableRow key={i}><TableCell colSpan={cols}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
        ))}
      </>
    ) : isError ? (
      <TableRow><TableCell colSpan={cols} className="text-center py-10">
        <p className="text-sm text-muted-foreground mb-3">Could not load products.</p>
        <Button variant="outline" size="sm" onClick={() => { productsQ.refetch(); inventoryQ.refetch(); }}>Try again</Button>
      </TableCell></TableRow>
    ) : (
      <TableRow><TableCell colSpan={cols} className="text-center py-12 text-muted-foreground">
        <Package className="h-10 w-10 mx-auto mb-3 opacity-40" aria-hidden />
        <p className="font-medium text-foreground">{products.length ? 'No products match your filters' : 'No products yet'}</p>
        {!products.length && <Button className="mt-3" size="sm" onClick={openAdd}><Plus className="h-4 w-4 mr-1" aria-hidden />Add product</Button>}
      </TableCell></TableRow>
    );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <span className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-primary" aria-hidden />
              </span>
              Products & Inventory
            </h1>
            <p className="text-muted-foreground mt-1">
              Catalog, POS availability and stock{currentBranchName ? ` · ${currentBranchName}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <Tags className="mr-2 h-4 w-4" aria-hidden />Categories
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden />Import purchase bill
            </Button>
            <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" aria-hidden />Add product</Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          {[
            { label: 'Products', value: String(products.length), Icon: Package, hint: `${categories.length} categories` },
            { label: 'Live on POS', value: String(liveCount), Icon: Store, hint: setupCount ? `${setupCount} not on sale` : 'All on sale' },
            { label: 'Low / out of stock', value: String(lowCount), Icon: AlertTriangle, hint: 'At or below reorder level', tone: lowCount ? 'text-amber-500' : '' },
            { label: 'Stock value (cost)', value: inr(stockValue), Icon: TrendingUp, hint: 'Units in stock × cost price' },
          ].map((s) => (
            <Card key={s.label} className="col-span-6 lg:col-span-3 rounded-xl border border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <s.Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                </div>
                <p className={`text-2xl sm:text-3xl font-bold tabular-nums mt-2 ${s.tone ?? 'text-foreground'}`}>{isLoading ? '—' : s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <TabsList className="bg-muted/50 w-full lg:w-auto overflow-x-auto justify-start">
              <TabsTrigger value="products" className="gap-2"><Package className="h-4 w-4" aria-hidden />Catalog</TabsTrigger>
              <TabsTrigger value="inventory" className="gap-2"><Archive className="h-4 w-4" aria-hidden />Stock</TabsTrigger>
              <TabsTrigger value="activate" className="gap-2">
                <Sparkles className="h-4 w-4" aria-hidden />Ready to sell
                {setupCount > 0 && <Badge className="ml-1 h-5 px-1.5 bg-accent text-accent-foreground">{setupCount}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" aria-hidden />History</TabsTrigger>
            </TabsList>

            {(activeTab === 'products' || activeTab === 'inventory') && (
              <div className="flex flex-1 flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input placeholder="Search name or SKU" aria-label="Search products" className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter by category"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {activeTab === 'inventory' && (
                  <Select value={stockFilter} onValueChange={setStockFilter}>
                    <SelectTrigger className="w-[150px]" aria-label="Filter by stock"><SelectValue placeholder="Stock" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All stock</SelectItem>
                      <SelectItem value="in-stock">In stock</SelectItem>
                      <SelectItem value="low">Low / out</SelectItem>
                      <SelectItem value="untracked">Not counted</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>

          {lowCount > 0 && activeTab === 'products' && (
            <Card className="rounded-xl border border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-4 flex items-center gap-4">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" aria-hidden />
                <p className="flex-1 text-sm">
                  <span className="font-medium">{lowCount} product{lowCount > 1 ? 's are' : ' is'} low or out of stock.</span>{' '}
                  <span className="text-muted-foreground">Receive a batch or adjust the count.</span>
                </p>
                <Button variant="outline" size="sm" onClick={() => { setActiveTab('inventory'); setStockFilter('low'); }}>View items</Button>
              </CardContent>
            </Card>
          )}

          <TabsContent value="products" className="m-0">
            <Card className="rounded-xl border border-border">
              <CardContent className="p-0 sm:p-2">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead scope="col" className="min-w-[220px]">Product</TableHead>
                        <TableHead scope="col">Category</TableHead>
                        <TableHead scope="col" className="text-right">Price</TableHead>
                        <TableHead scope="col" className="text-right">Cost</TableHead>
                        <TableHead scope="col" className="text-right">Margin</TableHead>
                        <TableHead scope="col" className="text-right">Stock</TableHead>
                        <TableHead scope="col">POS</TableHead>
                        <TableHead scope="col" className="text-right"><span className="sr-only">Actions</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading || isError || filtered.length === 0 ? <TableState cols={8} /> : filtered.map((p) => {
                        const margin = marginPercent(p.price, p.cost_price);
                        const stock = stockByProduct.get(p.id);
                        return (
                          <TableRow key={p.id} className="hover:bg-muted/50 transition-colors duration-150">
                            <TableCell><ProductCell p={p} /></TableCell>
                            <TableCell>
                              {p.product_categories?.name ? <Badge variant="secondary" className="font-normal">{p.product_categories.name}</Badge> : <span className="text-muted-foreground text-sm">{p.category || '—'}</span>}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {Number(p.price) > 0 ? inr(Number(p.price)) : <span className="text-amber-500 text-sm font-medium whitespace-nowrap">Not set</span>}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">{p.cost_price ? inr(Number(p.cost_price)) : '—'}</TableCell>
                            <TableCell className="text-right">
                              {margin === null ? <span className="text-muted-foreground">—</span> : (
                                <Badge variant="outline" className={`font-normal tabular-nums ${margin < 0 ? 'text-destructive border-destructive/20' : margin < 10 ? 'text-amber-500 border-amber-500/20' : 'text-emerald-500 border-emerald-500/20'}`}>
                                  {margin}%
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`font-semibold tabular-nums ${statusOf(p) === 'out' ? 'text-destructive' : statusOf(p) === 'low' ? 'text-amber-500' : ''}`}>
                                {stock ? stock.qty : '—'}
                              </span>
                            </TableCell>
                            <TableCell><PosCell p={p} /></TableCell>
                            <TableCell><RowActions p={p} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {!isLoading && !isError && (
                  <p className="text-xs text-muted-foreground px-4 py-3">Showing {filtered.length} of {products.length} products</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inventory" className="m-0">
            <Card className="rounded-xl border border-border">
              {!branchFilter && branches.length > 1 && (
                <CardHeader className="pb-0">
                  <p className="text-sm text-muted-foreground">Showing totals across all branches. Pick a branch in the header to adjust its stock.</p>
                </CardHeader>
              )}
              <CardContent className="p-0 sm:p-2">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card">
                      <TableRow>
                        <TableHead scope="col" className="min-w-[260px]">Product</TableHead>
                        <TableHead scope="col" className="text-right">In stock</TableHead>
                        <TableHead scope="col" className="text-right">Reorder at</TableHead>
                        <TableHead scope="col">Status</TableHead>
                        <TableHead scope="col">POS</TableHead>
                        <TableHead scope="col" className="text-right"><span className="sr-only">Actions</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading || isError || filteredStock.length === 0 ? <TableState cols={6} /> : filteredStock.map((p) => {
                        const stock = stockByProduct.get(p.id);
                        return (
                          <TableRow key={p.id} className="hover:bg-muted/50 transition-colors duration-150">
                            <TableCell><ProductCell p={p} /></TableCell>
                            <TableCell className="text-right text-lg font-semibold tabular-nums">{stock ? stock.qty : '—'}</TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">{stock ? stock.min : '—'}</TableCell>
                            <TableCell><StockBadge status={statusOf(p)} /></TableCell>
                            <TableCell><PosCell p={p} /></TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                {p.requires_batch_tracking && (
                                  <Button variant="outline" size="sm" className="h-9" onClick={() => setAddBatchProduct(p)}>
                                    <Plus className="h-4 w-4 mr-1" aria-hidden />Batch
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" className="h-9" onClick={() => setAdjustProduct(p)} disabled={!stockBranchId} title={!stockBranchId ? 'Pick a branch first' : undefined}>
                                  <SlidersHorizontal className="h-4 w-4 mr-1" aria-hidden />Adjust
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {!isLoading && !isError && (
                  <p className="text-xs text-muted-foreground px-4 py-3">Showing {filteredStock.length} of {products.length} products</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activate" className="m-0">
            <ProductsToActivate />
          </TabsContent>

          <TabsContent value="history" className="m-0">
            <StockHistoryTab branchId={branchFilter} />
          </TabsContent>
        </Tabs>
      </div>

      <ImportPurchaseBillDrawer open={importOpen} onOpenChange={setImportOpen} />
      <ManageCategoriesDrawer open={categoriesOpen} onOpenChange={setCategoriesOpen} />
      <ManageOptionsDrawer open={!!optionsParent} onOpenChange={(o) => !o && setOptionsParent(null)} parentId={optionsParent} />
      <AddProductDrawer open={drawerOpen} onOpenChange={setDrawerOpen} product={editingProduct} />

      <AdjustStockDrawer
        open={!!adjustProduct}
        onOpenChange={(o) => !o && setAdjustProduct(null)}
        product={adjustProduct}
        branchId={stockBranchId}
        branchName={stockBranchName}
        onAddBatch={() => { const p = adjustProduct; setAdjustProduct(null); setAddBatchProduct(p); }}
      />

      {addBatchProduct && (
        <AddBatchDrawer
          open={!!addBatchProduct}
          onOpenChange={(o) => !o && setAddBatchProduct(null)}
          product={{ ...addBatchProduct, branch_id: addBatchProduct.branch_id ?? stockBranchId ?? null }}
        />
      )}

      <Sheet open={!!batchesProduct} onOpenChange={(o) => !o && setBatchesProduct(null)}>
        <SheetContent className="sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Batches · {batchesProduct?.name}</SheetTitle>
            <SheetDescription>Manufacturing dates, expiry and lab test reports per batch.</SheetDescription>
          </SheetHeader>
          {batchesProduct && <div className="mt-6"><ProductBatchesTab product={batchesProduct} /></div>}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from the catalog, POS and member store. Past sales, invoices and stock history are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
