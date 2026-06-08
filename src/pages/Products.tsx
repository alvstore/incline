import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AddProductDrawer } from '@/components/products/AddProductDrawer';
import { ProductBatchesTab } from '@/components/products/ProductBatchesTab';
import { 
  Plus, 
  Package, 
  AlertTriangle, 
  TrendingUp,
  Tag,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Archive,
  BarChart3,
  Layers,
  ShieldCheck
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [batchesProduct, setBatchesProduct] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('products');

  // Fetch products with categories
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*, product_categories(id, name)')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch inventory data
  const { data: inventory = [], isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(`*, products(*, product_categories(id, name))`)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Delete product mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Product deleted');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: () => {
      toast.error('Failed to delete product');
    },
  });

  // Toggle product status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ productId, isActive }: { productId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('products')
        .update({ is_active: isActive })
        .eq('id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product status updated');
    },
  });

  // Filter products
  const filteredProducts = products.filter((p: any) => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category_id === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Filter inventory
  const filteredInventory = inventory.filter((item: any) => {
    const productName = item.products?.name || '';
    const matchesSearch = productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.products?.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || item.products?.category_id === categoryFilter;
    const isLow = item.quantity <= (item.min_quantity || 5);
    const matchesStock = stockFilter === 'all' || 
      (stockFilter === 'low' && isLow) ||
      (stockFilter === 'in-stock' && !isLow);
    return matchesSearch && matchesCategory && matchesStock;
  });

  // Calculate stats
  const lowStockItems = inventory.filter((item: any) => 
    item.quantity <= (item.min_quantity || 5)
  );
  
  const stats = {
    totalProducts: products.length,
    lowStock: lowStockItems.length,
    totalValue: inventory.reduce((sum: number, item: any) => 
      sum + (item.quantity * (item.products?.price || 0)), 0
    ),
    categories: categories.length,
  };

  const handleEdit = (product: any) => {
    setEditingProduct(product);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingProduct(null);
    setDrawerOpen(true);
  };

  const isLoading = productsLoading || inventoryLoading;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-primary" />
              </div>
              Products & Inventory
            </h1>
            <p className="text-muted-foreground mt-1">Manage your product catalog and stock levels</p>
          </div>
          <Button onClick={handleAdd} className="bg-primary hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Total Products</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.totalProducts}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-card/20 flex items-center justify-center">
                  <Package className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-warning to-warning/80 text-warning-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Low Stock</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.lowStock}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-card/20 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-success to-success/80 text-success-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Stock Value</p>
                  <h3 className="text-3xl font-bold mt-1">₹{stats.totalValue.toLocaleString()}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-card/20 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-info to-info/80 text-info-foreground">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-80">Categories</p>
                  <h3 className="text-3xl font-bold mt-1">{stats.categories}</h3>
                </div>
                <div className="h-12 w-12 rounded-full bg-card/20 flex items-center justify-center">
                  <Tag className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Low Stock Alert */}
        {lowStockItems.length > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-warning">Low Stock Alert</p>
                <p className="text-sm text-muted-foreground">
                  {lowStockItems.length} product{lowStockItems.length > 1 ? 's are' : ' is'} running low on stock
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                className="border-warning/50 text-warning hover:bg-warning/10"
                onClick={() => {
                  setActiveTab('inventory');
                  setStockFilter('low');
                }}
              >
                View Items
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="products" className="gap-2">
                <Package className="h-4 w-4" />
                Products
              </TabsTrigger>
              <TabsTrigger value="inventory" className="gap-2">
                <Archive className="h-4 w-4" />
                Inventory
              </TabsTrigger>
            </TabsList>

            {/* Filters */}
            <div className="flex flex-1 gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeTab === 'inventory' && (
                <Select value={stockFilter} onValueChange={setStockFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Stock" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stock</SelectItem>
                    <SelectItem value="in-stock">In Stock</SelectItem>
                    <SelectItem value="low">Low Stock</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Products Tab */}
          <TabsContent value="products" className="m-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  Product Catalog
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-[300px]">Product</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProducts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                              <Package className="h-12 w-12 mx-auto mb-4 opacity-30" />
                              <p>No products found</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredProducts.map((product: any) => {
                            const margin = product.cost_price 
                              ? ((product.price - product.cost_price) / product.price * 100).toFixed(1)
                              : null;
                            return (
                              <TableRow key={product.id} className="group">
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                                      {product.image_url ? (
                                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                                      ) : (
                                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium">{product.name}</p>
                                        {product.requires_batch_tracking && (
                                          <Badge className="bg-primary/15 text-primary rounded-full text-[10px] font-medium px-2 py-0">
                                            <Layers className="h-3 w-3 mr-1" /> Batch
                                          </Badge>
                                        )}
                                        {product.requires_lab_report && (
                                          <Badge className="bg-success/15 text-success rounded-full text-[10px] font-medium px-2 py-0">
                                            <ShieldCheck className="h-3 w-3 mr-1" /> CoA
                                          </Badge>
                                        )}
                                      </div>
                                      {product.description && (
                                        <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">{product.description}</p>
                                      )}
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                    {product.sku || '-'}
                                  </code>
                                </TableCell>
                                <TableCell>
                                  {product.product_categories?.name ? (
                                    <Badge variant="secondary" className="font-normal">
                                      {product.product_categories.name}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  ₹{product.price?.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {product.cost_price ? `₹${product.cost_price.toLocaleString()}` : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  {margin ? (
                                    <Badge variant="outline" className={`font-normal ${Number(margin) > 30 ? 'text-success border-success/30' : Number(margin) < 10 ? 'text-warning border-warning/30' : ''}`}>
                                      {margin}%
                                    </Badge>
                                  ) : '-'}
                                </TableCell>
                                <TableCell>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => handleEdit(product)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      {product.requires_batch_tracking && (
                                        <DropdownMenuItem onClick={() => setBatchesProduct(product)}>
                                          <Layers className="h-4 w-4 mr-2" />
                                          Manage Batches
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() => deleteMutation.mutate(product.id)}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="m-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  Stock Levels
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-[300px]">Product</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-center">Quantity</TableHead>
                          <TableHead className="text-center">Min Stock</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-center">Active</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInventory.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                              <Archive className="h-12 w-12 mx-auto mb-4 opacity-30" />
                              <p>No inventory items found</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredInventory.map((item: any) => {
                            const isLow = item.quantity <= (item.min_quantity || 5);
                            const isActive = item.products?.is_active !== false;
                            
                            return (
                              <TableRow key={item.id} className="group">
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                                      {item.products?.image_url ? (
                                        <img 
                                          src={item.products.image_url} 
                                          alt={item.products.name}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <Package className="h-5 w-5 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div>
                                      <p className="font-medium">{item.products?.name}</p>
                                      <p className="text-xs text-muted-foreground font-mono">
                                        SKU: {item.products?.sku || 'N/A'}
                                      </p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {item.products?.product_categories?.name ? (
                                    <Badge variant="secondary" className="font-normal">
                                      {item.products.product_categories.name}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">General</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  ₹{(item.products?.price || 0).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-center">
                                  <span className={`font-semibold ${isLow ? 'text-warning' : 'text-foreground'}`}>
                                    {item.quantity}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center text-muted-foreground">
                                  {item.min_quantity || 5}
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant="outline"
                                    className={isLow 
                                      ? 'bg-warning/10 text-warning border-warning/30' 
                                      : 'bg-success/10 text-success border-success/30'
                                    }
                                  >
                                    {isLow ? 'Low Stock' : 'In Stock'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Switch
                                    checked={isActive}
                                    onCheckedChange={(checked) => {
                                      toggleStatusMutation.mutate({
                                        productId: item.product_id,
                                        isActive: checked,
                                      });
                                    }}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AddProductDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        product={editingProduct}
      />

      <Sheet open={!!batchesProduct} onOpenChange={(o) => !o && setBatchesProduct(null)}>
        <SheetContent className="sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Batches · {batchesProduct?.name}</SheetTitle>
            <SheetDescription>Track manufacturing dates, expiry and lab test reports per batch.</SheetDescription>
          </SheetHeader>
          {batchesProduct && (
            <div className="mt-6">
              <ProductBatchesTab product={batchesProduct} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
