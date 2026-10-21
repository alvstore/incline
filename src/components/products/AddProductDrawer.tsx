import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AddCategoryDrawer } from '@/components/products/AddCategoryDrawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Loader2, Link as LinkIcon, Plus } from 'lucide-react';
import { uploadProductImage, createProduct, updateProduct } from '@/services/productService';
import { adjustStock } from '@/services/inventoryService';
import { DEFAULT_PRODUCT_IMAGE } from '@/lib/products/productRules';
import { useBranchContext } from '@/contexts/BranchContext';
import { VariantsEditor } from '@/components/products/VariantsEditor';
import { PRODUCT_VARIANTS_ENABLED, emptyVariant, validateVariants, variantName, type VariantDraft } from '@/lib/products/variantRules';

interface AddProductDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: any;
}

const EMPTY_FORM = {
  name: '',
  description: '',
  sku: '',
  price: '',
  cost_price: '',
  tax_rate: 0,
  category_id: '',
  branch_id: '',
  is_sellable: true,
  hsn_code: '',
  image_url: '',
  initial_quantity: '',
  requires_batch_tracking: false,
  requires_lab_report: false,
  default_shelf_life_days: '',
};

export function AddProductDrawer({ open, onOpenChange, product }: AddProductDrawerProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!product;
  const { effectiveBranchId, branchFilter } = useBranchContext();

  const [formData, setFormData] = useState<any>(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const [hasOptions, setHasOptions] = useState(false);
  const [optionType, setOptionType] = useState('Flavour');
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant(), emptyVariant()]);

  // Sync form when drawer opens or product changes (fixes "edit doesn't pre-fill" bug)
  useEffect(() => {
    if (!open) return;
    setHasOptions(false);
    setOptionType('Flavour');
    setVariants([emptyVariant(), emptyVariant()]);
    if (product) {
      setFormData({
        name: product.name || '',
        description: product.description || '',
        sku: product.sku || '',
        price: product.price ?? '',
        cost_price: product.cost_price ?? '',
        tax_rate: product.tax_rate ?? 0,
        category_id: product.category_id || '',
        branch_id: product.branch_id || '',
        is_sellable: product.is_sellable ?? false,
        hsn_code: product.hsn_code || '',
        image_url: product.image_url || '',
        initial_quantity: '',
        requires_batch_tracking: product.requires_batch_tracking ?? false,
        requires_lab_report: product.requires_lab_report ?? false,
        default_shelf_life_days: product.default_shelf_life_days ?? '',
      });
      setImagePreview(product.image_url || '');
    } else {
      setFormData(EMPTY_FORM);
      setImagePreview('');
    }
    setImageUrlInput('');
  }, [open, product]);

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

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('branches').select('id, name');
      if (error) throw error;
      return data;
    },
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }
    setUploading(true);
    try {
      const publicUrl = await uploadProductImage(file);
      setFormData((f: any) => ({ ...f, image_url: publicUrl }));
      setImagePreview(publicUrl);
      toast.success('Image uploaded successfully');
    } catch (error: any) {
      toast.error('Failed to upload image: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFetchImageUrl = async () => {
    if (!imageUrlInput.trim()) {
      toast.error('Enter an image URL');
      return;
    }
    setFetchingUrl(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-image-url', {
        body: { imageUrl: imageUrlInput.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error('No URL returned');
      setFormData((f: any) => ({ ...f, image_url: data.url }));
      setImagePreview(data.url);
      setImageUrlInput('');
      toast.success('Image fetched and saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to fetch image');
    } finally {
      setFetchingUrl(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sellable = !!formData.is_sellable;
      const imageUrl = formData.image_url || (sellable ? DEFAULT_PRODUCT_IMAGE : null);
      const payload = {
        name: formData.name.trim(),
        description: formData.description || null,
        sku: formData.sku || null,
        price: Number(formData.price) || 0,
        cost_price: formData.cost_price ? Number(formData.cost_price) : null,
        tax_rate: formData.tax_rate ? Number(formData.tax_rate) : null,
        category_id: formData.category_id || null,
        branch_id: formData.branch_id || null,
        is_sellable: sellable,
        hsn_code: formData.hsn_code?.trim() || null,
        image_url: imageUrl,
        requires_batch_tracking: !!formData.requires_batch_tracking,
        requires_lab_report: !!formData.requires_batch_tracking && !!formData.requires_lab_report,
        default_shelf_life_days: formData.default_shelf_life_days
          ? Number(formData.default_shelf_life_days)
          : null,
      };

      if (isEditing) return updateProduct(product.id, payload as any);

      if (hasOptions) {
        const stockBranch = formData.branch_id || branchFilter || effectiveBranchId;
        const prices = variants.map((v) => Number(v.price) || 0).filter((p) => p > 0);
        const parent = await createProduct({
          ...payload,
          sku: payload.sku,
          price: prices.length ? Math.min(...prices) : 0,
          cost_price: null,
          is_sellable: false,
          image_url: formData.image_url || null,
          is_variant_parent: true,
          option_type: optionType.trim(),
        } as any);
        for (const [i, v] of variants.entries()) {
          const child = await createProduct({
            ...payload,
            name: variantName(payload.name, v.value),
            sku: v.sku.trim() || null,
            price: Number(v.price) || 0,
            cost_price: v.cost_price ? Number(v.cost_price) : null,
            image_url: v.image_url || imageUrl,
            parent_product_id: parent.id,
            option_type: optionType.trim(),
            option_value: v.value.trim(),
            swatch_color: v.swatch_color || null,
            variant_sort: i,
          } as any);
          const qty = Math.floor(Number(v.opening_stock) || 0);
          if (!formData.requires_batch_tracking && qty > 0 && stockBranch) {
            await adjustStock({ productId: child.id, branchId: stockBranch, mode: 'add', quantity: qty, reason: 'opening', notes: 'Opening stock on product creation' });
          }
        }
        return parent;
      }

      const newProduct = await createProduct(payload as any);
      // Batch-tracked products receive stock through batches; others get opening stock via the audited stock RPC.
      if (!formData.requires_batch_tracking && formData.initial_quantity && Number(formData.initial_quantity) > 0) {
        const branchId = formData.branch_id || branchFilter || effectiveBranchId;
        if (branchId) {
          await adjustStock({
            productId: newProduct.id,
            branchId,
            mode: 'add',
            quantity: Math.floor(Number(formData.initial_quantity)),
            reason: 'opening',
            notes: 'Opening stock on product creation',
          });
        }
      }
      return newProduct;
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Product updated' : 'Product created');
      ['products', 'pos-products', 'inventory', 'products-to-activate', 'stock-movements'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
      onOpenChange(false);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to save product'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name?.trim()) {
      toast.error('Product name is required');
      return;
    }
    if (formData.is_sellable && !(Number(formData.price) > 0)) {
      toast.error('Set a selling price above ₹0 to sell on POS, or switch off "Sell on POS"');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEditing ? 'Edit Product' : 'Add New Product'}</SheetTitle>
          <SheetDescription>
            {isEditing ? 'Update product details' : 'Add a new product to your inventory'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Product Image</Label>
            <button
              type="button"
              className="w-full border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => fileInputRef.current?.click()}
              aria-label={imagePreview ? 'Change product photo' : 'Upload product photo'}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Uploading...</p>
                </div>
              ) : imagePreview ? (
                <div className="relative">
                  <img src={imagePreview} alt="Product preview" className="max-h-40 mx-auto rounded" />
                  <p className="text-xs text-muted-foreground mt-2">Click to change</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload image</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG, WebP up to 5MB</p>
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            {!imagePreview && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setFormData((f: typeof EMPTY_FORM) => ({ ...f, image_url: DEFAULT_PRODUCT_IMAGE }));
                  setImagePreview(DEFAULT_PRODUCT_IMAGE);
                }}
              >
                Use standard Incline photo
              </Button>
            )}

            {/* Image URL fetch */}
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="…or paste an image URL"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                disabled={fetchingUrl}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchImageUrl}
                disabled={fetchingUrl || !imageUrlInput.trim()}
              >
                {fetchingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                <span className="ml-2">Fetch</span>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">Product Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Whey Protein"
                required
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Product description..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                placeholder="PRD-001"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="category">Category</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoryDrawerOpen(true)}
                >
                  <Plus className="h-3 w-3 mr-1" aria-hidden />New category
                </Button>
              </div>
              <Select
                value={formData.category_id}
                onValueChange={(v) => setFormData({ ...formData, category_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Selling Price (₹){formData.is_sellable ? ' *' : ''}</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="999"
                required={!!formData.is_sellable}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cost_price">Cost Price (₹)</Label>
              <Input
                id="cost_price"
                type="number"
                min="0"
                step="0.01"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                placeholder="500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tax_rate">Tax Rate (%)</Label>
              <Input
                id="tax_rate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.tax_rate}
                onChange={(e) => setFormData({ ...formData, tax_rate: Number(e.target.value) })}
                placeholder="18"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hsn_code">HSN code</Label>
              <Input
                id="hsn_code"
                value={formData.hsn_code}
                onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                placeholder="2106"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <Select
                value={formData.branch_id || '__all__'}
                onValueChange={(v) => setFormData({ ...formData, branch_id: v === '__all__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Branches</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isEditing && !formData.requires_batch_tracking && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="initial_quantity">Opening stock</Label>
                <Input
                  id="initial_quantity"
                  type="number"
                  min="0"
                  value={formData.initial_quantity}
                  onChange={(e) => setFormData({ ...formData, initial_quantity: e.target.value })}
                  placeholder="50"
                />
                <p className="text-xs text-muted-foreground">Units on the shelf today. You can adjust stock any time.</p>
              </div>
            )}
          </div>

          {/* Batch & Compliance */}
          <div className="space-y-3 rounded-xl border bg-muted/60 p-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Batch & Compliance</h4>
              <p className="text-xs text-muted-foreground">
                Turn on for proteins, supplements and any product that needs expiry & lab reports.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="requires_batch_tracking">Track batches & expiry</Label>
                <p className="text-xs text-muted-foreground">Stock is added per batch (FEFO at POS).</p>
              </div>
              <Switch
                id="requires_batch_tracking"
                checked={formData.requires_batch_tracking}
                onCheckedChange={(checked) =>
                  setFormData({
                    ...formData,
                    requires_batch_tracking: checked,
                    requires_lab_report: checked ? formData.requires_lab_report : false,
                  })
                }
              />
            </div>

            {formData.requires_batch_tracking && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="requires_lab_report">Require Lab Test Report (CoA)</Label>
                    <p className="text-xs text-muted-foreground">Block batch creation without a report.</p>
                  </div>
                  <Switch
                    id="requires_lab_report"
                    checked={formData.requires_lab_report}
                    onCheckedChange={(checked) => setFormData({ ...formData, requires_lab_report: checked })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default_shelf_life_days">Default shelf life (days)</Label>
                  <Input
                    id="default_shelf_life_days"
                    type="number"
                    min="1"
                    value={formData.default_shelf_life_days}
                    onChange={(e) => setFormData({ ...formData, default_shelf_life_days: e.target.value })}
                    placeholder="730"
                  />
                  <p className="text-xs text-muted-foreground">Auto-fills expiry date when entering a batch.</p>
                </div>
              </>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-muted/40">
            <div>
              <Label htmlFor="is_sellable">Sell on POS & member store</Label>
              <p className="text-xs text-muted-foreground">
                {formData.is_sellable
                  ? formData.image_url
                    ? 'Shown at the counter and in the member store.'
                    : 'No photo yet — the standard Incline photo will be used.'
                  : 'Kept in the catalog and stock, but not offered for sale.'}
              </p>
            </div>
            <Switch
              id="is_sellable"
              checked={!!formData.is_sellable}
              onCheckedChange={(checked) => setFormData({ ...formData, is_sellable: checked })}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending} className="flex-1">
              {saveMutation.isPending ? 'Saving...' : isEditing ? 'Update Product' : 'Add Product'}
            </Button>
          </div>
        </form>
      </SheetContent>
      <AddCategoryDrawer
        open={categoryDrawerOpen}
        onOpenChange={setCategoryDrawerOpen}
        onCreated={(id) => setFormData((prev: any) => ({ ...prev, category_id: id }))}
      />
    </Sheet>
  );
}
