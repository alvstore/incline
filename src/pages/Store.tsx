import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingBag, Package, ShoppingCart, ExternalLink, AlertTriangle, Boxes, TrendingUp, DollarSign, CreditCard, MoreVertical, XCircle, CheckCircle as CheckCircleIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { AdBannerManager } from '@/components/banners/AdBannerManager';
import { useBranchContext } from '@/contexts/BranchContext';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { recordPayment, voidPayment } from '@/services/billingService';
import { useAuth } from '@/contexts/AuthContext';

export default function StorePage() {
  const { selectedBranch } = useBranchContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useRealtimeInvalidate({
    channel: 'page-store',
    tables: ['products', 'inventory', 'invoices', 'pos_sales', 'payments'],
    invalidateKeys: [
      ['store-products'],
      ['member-store-orders'],
      ['store-pos-sales'],
      ['store-inventory-stats'],
    ],
  });
  const BannerManager = () => selectedBranch && selectedBranch !== 'all' ? <AdBannerManager branchId={selectedBranch} /> : <p className="text-center text-muted-foreground py-8">Select a branch to manage banners</p>;

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['store-products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch member store orders from invoices — typed `source` column with notes fallback for legacy rows
  const { data: memberStoreOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['member-store-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          members(member_code, profiles:user_id(full_name)),
          invoice_items(description, quantity, unit_price, total_amount, reference_type)
        `)
        .or('source.eq.member_store,source.eq.ecommerce,notes.ilike.%store%purchase%')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Fetch POS sales
  const { data: posSales = [], isLoading: posLoading } = useQuery({
    queryKey: ['store-pos-sales'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pos_sales')
        .select(`
          *,
          members(member_code, profiles:user_id(full_name)),
          invoices!pos_sales_invoice_id_fkey(invoice_number)
        `)
        .order('sale_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  // Fetch inventory stats
  const { data: inventoryStats } = useQuery({
    queryKey: ['store-inventory-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(`quantity, min_quantity, products(price, name)`);

      if (error) throw error;

      const totalValue = data?.reduce((sum, i: any) => {
        return sum + ((i.quantity || 0) * (i.products?.price || 0));
      }, 0) || 0;

      const lowStockItems = data?.filter((i: any) => (i.quantity || 0) < (i.min_quantity || 10)).length || 0;
      const totalItems = data?.reduce((sum, i: any) => sum + (i.quantity || 0), 0) || 0;

      return { totalValue, lowStockItems, totalItems };
    },
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-warning/10 text-warning',
      processing: 'bg-info/10 text-info',
      shipped: 'bg-accent/10 text-accent',
      delivered: 'bg-success/10 text-success',
      cancelled: 'bg-destructive/10 text-destructive',
      completed: 'bg-success/10 text-success',
      paid: 'bg-success/10 text-success',
    };
    return colors[status] || 'bg-muted text-muted-foreground';
  };

  // Calculate stats - exclude awaiting/cancelled for Profit/Revenue
  const onlineOrdersTotal = memberStoreOrders
    .filter((o: any) => o.status === 'paid' || o.status === 'completed')
    .reduce((sum: number, o: any) => sum + o.total_amount, 0);

  // Realized revenue = Paid/Completed POS sales
  const realizedPosTotal = posSales
    .filter((s: any) => s.payment_status === 'paid' || s.payment_status === 'completed')
    .reduce((sum: number, s: any) => sum + s.total_amount, 0);
  
  // Pending revenue = Awaiting Payment POS sales
  const pendingPosTotal = posSales
    .filter((s: any) => s.payment_status === 'awaiting_payment' || s.payment_status === 'pending')
    .reduce((sum: number, s: any) => sum + s.total_amount, 0);

  const posTotal = realizedPosTotal; // For compatibility with existing cards
  const pendingOrders = memberStoreOrders.filter((o: any) => o.status === 'pending' || o.status === 'partial').length;
  
  const todayPosSales = posSales.filter((s: any) => {
    const today = new Date().toISOString().split('T')[0];
    return s.sale_date?.startsWith(today) && (s.payment_status === 'paid' || s.payment_status === 'completed');
  });
  
  const todayPosTotal = todayPosSales.reduce((sum: number, s: any) => sum + s.total_amount, 0);
  const totalRevenue = onlineOrdersTotal + realizedPosTotal;
  const projectedRevenue = totalRevenue + pendingPosTotal;

  // Sparkline data from last 7 realized POS sales
  const sparklineData = posSales
    .filter((s: any) => s.payment_status === 'paid' || s.payment_status === 'completed')
    .slice(0, 7)
    .reverse()
    .map((s: any) => ({ value: s.total_amount || 0 }));

  // Stock gauge data
  const stockUsed = inventoryStats?.totalItems || 0;
  const stockCapacity = Math.max(stockUsed, 100);
  const stockPercent = stockCapacity > 0 ? Math.round((stockUsed / stockCapacity) * 100) : 0;
  const stockGaugeData = [
    { name: 'Used', value: stockUsed },
    { name: 'Remaining', value: stockCapacity - stockUsed },
  ];

  const settlePaymentMutation = useMutation({
    mutationFn: async ({ invoiceId, amount, memberId }: { invoiceId: string, amount: number, memberId?: string }) => {
      await recordPayment({
        branchId: selectedBranch === 'all' ? undefined : selectedBranch,
        invoiceId,
        memberId,
        amount,
        paymentMethod: 'cash',
        notes: 'Manual settlement of POS Awaiting Payment',
        receivedBy: user?.id,
      });
    },
    onSuccess: () => {
      toast.success('Invoice settled successfully');
      queryClient.invalidateQueries({ queryKey: ['store-pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['member-store-orders'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to settle invoice'),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'cancelled', notes: 'Cancelled by admin from store dashboard' })
        .eq('id', invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invoice cancelled');
      queryClient.invalidateQueries({ queryKey: ['store-pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['member-store-orders'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to cancel invoice'),
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Store Management</h1>
            <p className="text-muted-foreground text-sm">POS, products & online store overview</p>
          </div>
          <div className="flex gap-2">
            <Link to="/pos">
              <Button className="shadow-lg shadow-primary/20 hover:shadow-xl">
                <ShoppingCart className="h-4 w-4 mr-2" />
                Open POS
              </Button>
            </Link>
            <Link to="/products">
              <Button variant="outline">
                <Package className="h-4 w-4 mr-2" />
                Manage Products
              </Button>
            </Link>
          </div>
        </div>

        {/* Hero Card */}
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl shadow-lg shadow-indigo-500/20 p-6 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Store Overview</h2>
              <p className="text-indigo-100/70 text-sm mt-1">Realized revenue and order performance across all channels</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold">{posSales.filter((s: any) => s.payment_status !== 'cancelled').length}</p>
                <p className="text-indigo-100/70 text-xs mt-1">Total Sales</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{products.length}</p>
                <p className="text-indigo-100/70 text-xs mt-1">Products</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">₹{todayPosTotal.toLocaleString()}</p>
                <p className="text-indigo-100/70 text-xs mt-1">Today's POS</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">₹{totalRevenue.toLocaleString()}</p>
                <p className="text-indigo-100/70 text-xs mt-1">Net Revenue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Profit / Stock / Low Stock Row */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Profit Card with sparkline */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Profit</CardTitle>
                <div className="h-8 w-8 rounded-xl bg-success/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-success" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">₹{totalRevenue.toLocaleString()}</p>
              <div className="h-[50px] mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparklineData}>
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Stock Value with donut */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Stock Value</CardTitle>
                <div className="h-8 w-8 rounded-xl bg-info/10 flex items-center justify-center">
                  <Boxes className="h-4 w-4 text-info" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">₹{(inventoryStats?.totalValue || 0).toLocaleString()}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="h-[50px] w-[50px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={stockGaugeData} cx="50%" cy="50%" innerRadius={16} outerRadius={24} dataKey="value" startAngle={90} endAngle={-270}>
                        <Cell fill="hsl(var(--info))" />
                        <Cell fill="hsl(var(--muted))" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{inventoryStats?.totalItems || 0} items</p>
                  <p className="text-xs text-muted-foreground">in stock</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Low Stock Alert */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Alert</CardTitle>
                <div className={`h-8 w-8 rounded-xl flex items-center justify-center ${(inventoryStats?.lowStockItems || 0) > 0 ? 'bg-warning/10' : 'bg-success/10'}`}>
                  <AlertTriangle className={`h-4 w-4 ${(inventoryStats?.lowStockItems || 0) > 0 ? 'text-warning' : 'text-success'}`} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${(inventoryStats?.lowStockItems || 0) > 0 ? 'text-warning' : 'text-success'}`}>
                {inventoryStats?.lowStockItems || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {(inventoryStats?.lowStockItems || 0) > 0 ? 'Items need restocking' : 'All stock levels are healthy'}
              </p>
              <div className="mt-3 flex gap-3 text-xs">
                <div className="rounded-lg bg-accent/10 px-2.5 py-1.5 font-medium text-accent">
                  {pendingOrders} pending orders
                </div>
                <div className="rounded-lg bg-success/10 px-2.5 py-1.5 font-medium text-success">
                  {todayPosSales.length} sales today
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Transactions + Tables */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent Transactions Timeline */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader>
              <CardTitle className="text-base font-bold text-foreground">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {posSales
                  .filter((s: any) => s.payment_status === 'paid' || s.payment_status === 'completed')
                  .slice(0, 8)
                  .map((sale: any) => {
                  const customer =
                    sale.customer_name ||
                    sale.members?.profiles?.full_name ||
                    sale.members?.member_code ||
                    'Walk-in';
                  return (
                    <div key={sale.id} className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <CreditCard className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{customer}</p>
                        <p className="text-xs text-muted-foreground capitalize">{sale.payment_method}</p>
                      </div>
                      <span className="text-sm font-bold text-success">
                        +₹{sale.total_amount?.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
                {posSales.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No sales yet</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Main Tables */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="pos-history">
              <TabsList>
                <TabsTrigger value="pos-history" className="gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  POS History ({posSales.length})
                </TabsTrigger>
                <TabsTrigger value="online-orders" className="gap-2">
                  <ShoppingBag className="h-4 w-4" />
                  Store Orders ({memberStoreOrders.length})
                </TabsTrigger>
                <TabsTrigger value="products">Products</TabsTrigger>
                <TabsTrigger value="banners">Ad Banners</TabsTrigger>
              </TabsList>

              <TabsContent value="pos-history" className="mt-4">
                <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
                  <CardContent className="pt-6">
                    {posLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date/Time</TableHead>
                            <TableHead>Invoice</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Payment</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {posSales.map((sale: any) => {
                            const customer =
                              sale.customer_name ||
                              sale.members?.profiles?.full_name ||
                              sale.members?.member_code ||
                              'Walk-in';
                            const customerPhone = sale.customer_phone;
                            const status = sale.payment_status;
                            const invoiceId = sale.invoice_id;
                            
                            return (
                              <TableRow key={sale.id}>
                                <TableCell>{format(new Date(sale.sale_date), 'dd MMM yyyy HH:mm')}</TableCell>
                                <TableCell className="font-mono text-xs">{sale.invoices?.invoice_number || '-'}</TableCell>
                                <TableCell>
                                  <div className="font-medium">{customer}</div>
                                  {customerPhone && <div className="text-xs text-muted-foreground">{customerPhone}</div>}
                                </TableCell>
                                <TableCell>{(sale.items as any[])?.length || 0} items</TableCell>
                                <TableCell className="font-medium">₹{sale.total_amount.toLocaleString()}</TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <Badge variant="outline" className="capitalize">{sale.payment_method}</Badge>
                                    {status === 'awaiting_payment' && (
                                      <Badge variant="destructive" className="text-[10px] animate-pulse">Awaiting Payment</Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {invoiceId && (status === 'awaiting_payment' || status === 'pending') ? (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                          <MoreVertical className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                                        <DropdownMenuItem 
                                          className="text-success gap-2 cursor-pointer"
                                          onClick={() => settlePaymentMutation.mutate({ 
                                            invoiceId, 
                                            amount: sale.total_amount,
                                            memberId: sale.member_id 
                                          })}
                                        >
                                          <CheckCircleIcon className="h-4 w-4" />
                                          Mark as Paid (Cash)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem 
                                          className="text-destructive gap-2 cursor-pointer"
                                          onClick={() => cancelInvoiceMutation.mutate(invoiceId)}
                                        >
                                          <XCircle className="h-4 w-4" />
                                          Cancel Invoice
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  ) : '-'}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {posSales.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                No POS sales yet
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="online-orders" className="mt-4">
                <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
                  <CardContent className="pt-6">
                    <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/10 text-xs text-muted-foreground flex items-start gap-2">
                      <ShoppingBag className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>
                        Orders placed by members from their member portal / online store. Walk-in counter sales appear under <strong>POS History</strong>.
                      </span>
                    </div>
                    {ordersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice #</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead>Items</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {memberStoreOrders.map((order: any) => (
                            <TableRow key={order.id}>
                              <TableCell className="font-mono">{order.invoice_number}</TableCell>
                              <TableCell>{order.members?.profiles?.full_name || order.members?.member_code || 'Guest'}</TableCell>
                              <TableCell>{(order.invoice_items as any[])?.length || 0} items</TableCell>
                              <TableCell className="font-medium">₹{order.total_amount.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge className={getStatusColor(order.status)}>{order.status}</Badge>
                              </TableCell>
                              <TableCell>{format(new Date(order.created_at), 'dd MMM yyyy HH:mm')}</TableCell>
                              <TableCell className="text-right">
                                {['pending', 'partial', 'overdue'].includes(order.status) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48 rounded-xl">
                                      <DropdownMenuItem 
                                        className="text-success gap-2 cursor-pointer"
                                        onClick={() => settlePaymentMutation.mutate({ 
                                          invoiceId: order.id, 
                                          amount: order.total_amount,
                                          memberId: order.member_id 
                                        })}
                                      >
                                        <CheckCircleIcon className="h-4 w-4" />
                                        Mark as Paid (Cash)
                                      </DropdownMenuItem>
                                      <DropdownMenuItem 
                                        className="text-destructive gap-2 cursor-pointer"
                                        onClick={() => cancelInvoiceMutation.mutate(order.id)}
                                      >
                                        <XCircle className="h-4 w-4" />
                                        Cancel Order
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {memberStoreOrders.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-40" />
                                <p className="font-medium text-foreground/70">No member online orders yet</p>
                                <p className="text-xs mt-1">Once members purchase from their portal, orders will show up here.</p>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="products" className="mt-4">
                <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base font-bold text-foreground">Available Products</CardTitle>
                    <Link to="/products">
                      <Button variant="outline" size="sm">
                        Manage Products
                        <ExternalLink className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </CardHeader>
                  <CardContent>
                    {productsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
                        {products.map((product: any) => (
                          <Card key={product.id} className="overflow-hidden rounded-xl border-none shadow-md shadow-primary/5">
                            <div className="aspect-square bg-muted flex items-center justify-center">
                              {product.image_url ? (
                                <img src={product.image_url} alt={product.name} className="object-cover w-full h-full" />
                              ) : (
                                <Package className="h-12 w-12 text-muted-foreground" />
                              )}
                            </div>
                            <CardContent className="p-4">
                              <h3 className="font-medium truncate text-foreground">{product.name}</h3>
                              <p className="text-sm text-muted-foreground">{product.category || 'General'}</p>
                              <p className="text-lg font-bold mt-2 text-primary">₹{product.price}</p>
                            </CardContent>
                          </Card>
                        ))}
                        {products.length === 0 && (
                          <div className="col-span-full text-center py-8 text-muted-foreground">
                            No products available
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="banners" className="mt-4">
                <BannerManager />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}