import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ResponsiveSheet, ResponsiveSheetHeader, ResponsiveSheetTitle, ResponsiveSheetDescription, ResponsiveSheetFooter } from '@/components/ui/ResponsiveSheet';
import { ShoppingCart, Plus, Minus, Trash2, CreditCard, Package, Wallet, Search, Receipt, User, Phone, Mail, UserPlus, FileText, Link2, Copy, Loader2, Tag, X, Check, MessageCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { createPOSSale, type CartItem } from '@/services/storeService';
import { getOrCreateWallet } from '@/services/walletService';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '@/contexts/BranchContext';
import { escapeHtml } from '@/utils/htmlEscape';
import { buildPaymentReceiptPdf } from '@/utils/pdfBlob';
import { blobToBase64 } from '@/utils/uploadAttachment';
import { sendWhatsAppDocument } from '@/utils/whatsappDocumentSender';

export default function POSPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { effectiveBranchId, currentBranchName } = useBranchContext();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [transactionId, setTransactionId] = useState('');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [showInvoice, setShowInvoice] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const [guestInfo, setGuestInfo] = useState({ name: '', phone: '', email: '' });
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [watchingInvoiceId, setWatchingInvoiceId] = useState<string | null>(null);

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null); // { id, code, discount_type, discount_value, min_purchase }
  const [couponValidating, setCouponValidating] = useState(false);

  // Wallet split: when on, deduct as much wallet as possible (up to balance & total) and bill the remainder
  const [useWallet, setUseWallet] = useState(false);

  // Realtime subscription for invoice status updates
  useEffect(() => {
    if (!watchingInvoiceId) return;
    const channel = supabase
      .channel(`pos-invoice-${watchingInvoiceId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'invoices',
        filter: `id=eq.${watchingInvoiceId}`,
      }, (payload) => {
        if (payload.new?.status === 'paid') {
          toast.success('✅ Payment Received! Invoice marked as Paid.');
          setWatchingInvoiceId(null);
          setPaymentLinkUrl(null);
          queryClient.invalidateQueries({ queryKey: ['today-pos-sales'] });
          queryClient.invalidateQueries({ queryKey: ['invoices'] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [watchingInvoiceId, queryClient]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['pos-products', categoryFilter],
    queryFn: async () => {
      let query = supabase
        .from('products')
        .select('*, product_categories(name), inventory(quantity, min_quantity, branch_id)')
        .eq('is_active', true)
        .order('name');
      
      if (categoryFilter) {
        query = query.eq('category_id', categoryFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Active, non-expired batches in the current branch — used for FEFO previews + stock for batch-tracked products.
  const { data: batchRows = [] } = useQuery({
    queryKey: ['pos-active-batches', effectiveBranchId],
    enabled: !!effectiveBranchId,
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await (supabase as any)
        .from('product_batches')
        .select('id, product_id, batch_number, exp_date, quantity_remaining, status')
        .eq('branch_id', effectiveBranchId)
        .eq('status', 'active')
        .gt('quantity_remaining', 0)
        .or(`exp_date.is.null,exp_date.gte.${today}`)
        .order('exp_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as Array<{ id: string; product_id: string; batch_number: string; exp_date: string | null; quantity_remaining: number; status: string }>;
    },
  });

  // Map: product_id -> { totalQty, nextBatch, expiringSoon }
  const batchMap = (() => {
    const m = new Map<string, { totalQty: number; nextBatch: { batch_number: string; exp_date: string | null }; expiringSoon: boolean }>();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 30);
    for (const b of batchRows) {
      const cur = m.get(b.product_id);
      const exp = b.exp_date ? new Date(b.exp_date) : null;
      const expiringSoon = !!exp && exp <= cutoff;
      if (!cur) {
        m.set(b.product_id, { totalQty: b.quantity_remaining, nextBatch: { batch_number: b.batch_number, exp_date: b.exp_date }, expiringSoon });
      } else {
        cur.totalQty += b.quantity_remaining;
      }
    }
    return m;
  })();

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

  // Enhanced member search - search by code, name, phone, email
  const { data: members = [] } = useQuery({
    queryKey: ['pos-members', memberSearch],
    queryFn: async () => {
      if (!memberSearch || memberSearch.length < 2) return [];
      
      // Use the search_members function for comprehensive search
      const { data, error } = await supabase.rpc('search_members', {
        search_term: memberSearch,
        p_limit: 10
      });
      
      if (error) {
        console.error('Member search error:', error);
        // Fallback to direct query
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('members')
          .select('id, member_code, user_id, profiles:user_id(full_name, phone, email)')
          .or(`member_code.ilike.%${memberSearch}%`)
          .limit(10);
        if (fallbackError) throw fallbackError;
        return fallbackData || [];
      }
      
      return data || [];
    },
    enabled: memberSearch.length >= 2,
  });

  const { data: walletBalance = 0 } = useQuery({
    queryKey: ['member-wallet', selectedMember?.id],
    queryFn: async () => {
      if (!selectedMember?.id) return 0;
      // Auto-create the wallet row on first POS reference so the UI is never "missing".
      const wallet = await getOrCreateWallet(selectedMember.id);
      // Postgres `numeric` is returned as a string by supabase-js — coerce defensively.
      return Number(wallet?.balance) || 0;
    },
    enabled: !!selectedMember?.id,
  });

  const { data: todaySales = [] } = useQuery({
    queryKey: ['today-pos-sales'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('pos_sales')
        .select('*, invoices!pos_sales_invoice_id_fkey(invoice_number)')
        .gte('sale_date', `${today}T00:00:00`)
        .lte('sale_date', `${today}T23:59:59`)
        .order('sale_date', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      // Use the active branch from context, NOT the first branch in DB
      if (!effectiveBranchId) {
        throw new Error('Please select a specific branch before ringing up a sale.');
      }
      const branchId = effectiveBranchId;

      const isPaymentLink = paymentMethod === 'razorpay_link';

      // Wallet split is only valid for in-person payments (not link)
      if (useWallet && isPaymentLink) {
        throw new Error('Wallet redemption cannot be combined with a payment link');
      }
      if (useWallet && !selectedMember) {
        throw new Error('Select a member to redeem wallet credits');
      }

      // If wallet covers the whole bill, the chosen "remainder" method is irrelevant —
      // but if there IS a remainder, ensure the user picked a proper non-wallet method.
      if (remainderDue > 0 && paymentMethod === 'wallet') {
        throw new Error('Choose a payment method for the remaining amount');
      }

      // Upload payment slip if provided (only when there's a non-wallet remainder)
      let slipUrl: string | undefined;
      if (slipFile && remainderDue > 0 && (paymentMethod === 'card' || paymentMethod === 'upi')) {
        const ext = slipFile.name.split('.').pop() || 'jpg';
        const path = `${branchId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('payment-slips').upload(path, slipFile);
        if (upErr) throw new Error('Slip upload failed: ' + upErr.message);
        slipUrl = path;
      }

      // Resolve the actual payment method to record for the remainder portion
      const remainderMethod = remainderDue > 0
        ? (isPaymentLink ? 'upi' : paymentMethod)
        : 'wallet'; // wallet-only sale

      const sale = await createPOSSale({
        branchId,
        memberId: selectedMember?.id,
        items: cart,
        paymentMethod: remainderMethod,
        transactionId: transactionId || undefined,
        slipUrl,
        guestName: !selectedMember ? guestInfo.name || undefined : undefined,
        guestPhone: !selectedMember ? guestInfo.phone || undefined : undefined,
        guestEmail: !selectedMember ? guestInfo.email || undefined : undefined,
        awaitingPayment: isPaymentLink,
        discountAmount: couponDiscount > 0 ? couponDiscount : undefined,
        discountCode: appliedCoupon?.code,
        discountCodeId: appliedCoupon?.id,
        walletApplied: walletApplied > 0 ? walletApplied : undefined,
      });

      // If payment link selected, generate Razorpay link instead of recording payment
      if (isPaymentLink && sale.invoice_id) {
        setPaymentLinkLoading(true);
        try {
          const { data: linkData, error: linkError } = await supabase.functions.invoke('create-razorpay-link', {
            body: { invoiceId: sale.invoice_id, amount: cartTotal, branchId },
          });
          if (linkError) throw new Error(linkError.message || 'Failed to generate payment link');
          if (linkData?.error) throw new Error(linkData.error);
          setPaymentLinkUrl(linkData.short_url);
          setWatchingInvoiceId(sale.invoice_id);
        } finally {
          setPaymentLinkLoading(false);
        }
      }

      return { ...sale, isPaymentLink };
    },
    onSuccess: (sale) => {
      if (sale.isPaymentLink) {
        toast.success('Invoice created & payment link generated!');
      } else {
        toast.success('Sale completed successfully! Invoice created.');
      }
      setLastSale({
        ...sale,
        items: cart,
        total: cartTotal,
        paymentMethod,
        member: selectedMember,
        walletApplied,
        remainderDue,
      });
      if (!sale.isPaymentLink) {
        setShowInvoice(true);
      }
      setCart([]);
      setSelectedMember(null);
      if (!sale.isPaymentLink) setPaymentMethod('cash');
      setTransactionId('');
      setSlipFile(null);
      setGuestInfo({ name: '', phone: '', email: '' });
      setShowGuestForm(false);
      setAppliedCoupon(null);
      setCouponInput('');
      setUseWallet(false);
      queryClient.invalidateQueries({ queryKey: ['today-pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['member-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['finance-income'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales-income'] });
    },
    onError: (error: any) => {
      // Show the full backend reason in a toast that stays long enough to read.
      const msg = error?.message || 'Unknown error';
      console.error('[POS] create sale failed:', error);
      toast.error('Failed to complete sale', {
        description: msg,
        duration: 8000,
      });
    },
  });

  const getStock = (product: any): number | null => {
    if (product.requires_batch_tracking) {
      // Stock comes from active, non-expired batches only
      return batchMap.get(product.id)?.totalQty ?? 0;
    }
    const inv = product.inventory?.[0];
    if (!inv) return null; // No inventory tracked
    return inv.quantity ?? 0;
  };

  const getMinStock = (product: any): number => {
    return product.inventory?.[0]?.min_quantity ?? 5;
  };

  const addToCart = (product: any) => {
    const stock = getStock(product);
    const existingQty = cart.find((item) => item.product.id === product.id)?.quantity || 0;
    if (product.requires_batch_tracking && (stock === null || stock <= 0)) {
      toast.error(`${product.name}: no active batch available. Add stock via a batch first.`);
      return;
    }
    if (stock !== null && existingQty + 1 > stock) {
      toast.error(`Only ${stock} in stock for ${product.name}`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  // Compute coupon discount on the current cart subtotal
  const couponDiscount = (() => {
    if (!appliedCoupon || cartSubtotal <= 0) return 0;
    if (appliedCoupon.min_purchase && cartSubtotal < Number(appliedCoupon.min_purchase)) return 0;
    const value = Number(appliedCoupon.discount_value) || 0;
    if (appliedCoupon.discount_type === 'percentage') {
      return Math.min(cartSubtotal, Math.round((cartSubtotal * value) / 100 * 100) / 100);
    }
    return Math.min(cartSubtotal, value);
  })();

  const cartTotal = Math.max(0, cartSubtotal - couponDiscount);
  const walletApplied = useWallet && selectedMember
    ? Math.min(walletBalance, cartTotal)
    : 0;
  const remainderDue = Math.max(0, cartTotal - walletApplied);

  const todayTotal = todaySales.reduce((sum: number, sale: any) => sum + sale.total_amount, 0);

  const validateCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    if (cartSubtotal <= 0) {
      toast.error('Add items to the cart first');
      return;
    }
    setCouponValidating(true);
    try {
      const { validateCoupon: validateCouponSvc, couponReasonLabel } = await import('@/services/couponService');
      const result = await validateCouponSvc({
        code,
        branchId: effectiveBranchId || null,
        subtotal: cartSubtotal,
      });
      if (!result.success) {
        const failure = result as { success: false; reason: string; min_purchase?: number };
        const label = couponReasonLabel(failure.reason);
        if (failure.reason === 'min_purchase' && failure.min_purchase) {
          toast.error(`Minimum purchase ₹${Number(failure.min_purchase).toLocaleString()} required`);
        } else {
          toast.error(label);
        }
        return;
      }
      // Store the validated preview (server is the source of truth on commit via record_sale)
      setAppliedCoupon({
        id: result.code_id,
        code: result.code,
        discount_type: result.discount_type,
        discount_value: result.discount_value,
        discount_amount: result.discount_amount,
      });
      toast.success(`Coupon ${result.code} applied`);
    } catch (err: any) {
      toast.error('Failed to validate coupon: ' + (err?.message || ''));
    } finally {
      setCouponValidating(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
  };

  const filteredProducts = products.filter((p: any) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const printInvoice = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice</title>
        <style>
          body { font-family: monospace; padding: 20px; max-width: 300px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
          .item { display: flex; justify-content: space-between; margin: 5px 0; }
          .total { border-top: 1px dashed #000; padding-top: 10px; margin-top: 10px; font-weight: bold; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; }
          .invoice-number { font-size: 12px; color: #666; margin-top: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>GYM STORE</h2>
          <p>${new Date().toLocaleString()}</p>
          ${lastSale?.member ? `<p>Member: ${escapeHtml(lastSale.member.member_code || lastSale.member.full_name)}</p>` : ''}
          ${lastSale?.invoice_id ? `<p class="invoice-number">Invoice: ${escapeHtml(lastSale.id?.slice(0, 8) ?? '')}</p>` : ''}
        </div>
        ${lastSale?.items?.map((item: any) => `
          <div class="item">
            <span>${escapeHtml(item.product.name)} x${item.quantity}</span>
            <span>₹${(item.product.price * item.quantity).toLocaleString()}</span>
          </div>
        `).join('')}
        <div class="total">
          <div class="item"><span>TOTAL</span><span>₹${lastSale?.total?.toLocaleString()}</span></div>
          ${lastSale?.walletApplied > 0 ? `
            <div class="item"><span>Wallet applied</span><span>−₹${Number(lastSale.walletApplied).toLocaleString()}</span></div>
            <div class="item"><span>Due paid</span><span>₹${Number(lastSale.remainderDue || 0).toLocaleString()}</span></div>
          ` : ''}
          <div class="item"><span>Payment</span><span>${lastSale?.paymentMethod?.toUpperCase()}</span></div>
        </div>
        <div class="footer">
          <p>Thank you for your purchase!</p>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  const getMemberDisplayInfo = (member: any) => {
    // Handle both search_members RPC result and direct query result
    const name = member.full_name || member.profiles?.full_name || member.member_code;
    const phone = member.phone || member.profiles?.phone || '';
    const email = member.email || member.profiles?.email || '';
    return { name, phone, email };
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Point of Sale</h1>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            Today's Sales: ₹{todayTotal.toLocaleString()}
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Products */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={categoryFilter || "all"} onValueChange={(val) => setCategoryFilter(val === "all" ? "" : val)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {categories.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
                {filteredProducts.map((product: any) => {
                  const stock = getStock(product);
                  const isOutOfStock = stock !== null && stock <= 0;
                  const isLowStock = stock !== null && stock > 0 && stock < getMinStock(product);

                  return (
                    <Card
                      key={product.id}
                      className={`transition-colors ${isOutOfStock ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'} ${isLowStock ? 'border-warning/50' : ''}`}
                      onClick={() => !isOutOfStock && addToCart(product)}
                    >
                      <CardContent className="p-4 relative">
                        {isOutOfStock && (
                          <Badge variant="destructive" className="absolute top-2 right-2 text-xs">Out of Stock</Badge>
                        )}
                        {isLowStock && (
                          <Badge className="absolute top-2 right-2 text-xs bg-warning text-warning-foreground">Low: {stock}</Badge>
                        )}
                        <div className="aspect-square bg-muted rounded flex items-center justify-center mb-3 overflow-hidden">
                          {product.image_url ? (
                            <img src={product.image_url} alt={product.name} className="object-cover w-full h-full" />
                          ) : (
                            <Package className="h-8 w-8 text-muted-foreground" />
                          )}
                        </div>
                        <h3 className="font-medium text-sm truncate">{product.name}</h3>
                        {product.requires_batch_tracking && (() => {
                          const info = batchMap.get(product.id);
                          if (!info) return (
                            <p className="text-[10px] text-destructive mt-0.5">No active batch</p>
                          );
                          const expLabel = info.nextBatch.exp_date
                            ? new Date(info.nextBatch.exp_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
                            : '—';
                          return (
                            <p className={`text-[10px] mt-0.5 truncate ${info.expiringSoon ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                              Batch {info.nextBatch.batch_number} · EXP {expLabel}{info.expiringSoon ? ' ⚠' : ''}
                            </p>
                          );
                        })()}
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-bold text-primary">₹{product.price}</p>
                          {stock !== null && !isOutOfStock && (
                            <span className="text-xs text-muted-foreground">{stock} left</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    No products found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="space-y-4">
            {/* Enhanced Member Selection */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedMember ? (
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{getMemberDisplayInfo(selectedMember).name}</p>
                        <div className="flex flex-col text-xs text-muted-foreground mt-1">
                          {getMemberDisplayInfo(selectedMember).phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {getMemberDisplayInfo(selectedMember).phone}
                            </span>
                          )}
                          {getMemberDisplayInfo(selectedMember).email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {getMemberDisplayInfo(selectedMember).email}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-primary mt-1">Wallet: ₹{Number(walletBalance).toLocaleString()}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedMember(null)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : showGuestForm ? (
                  <div className="space-y-2">
                    <Input
                      placeholder="Guest Name"
                      value={guestInfo.name}
                      onChange={(e) => setGuestInfo({ ...guestInfo, name: e.target.value })}
                    />
                    <Input
                      placeholder="Phone Number"
                      value={guestInfo.phone}
                      onChange={(e) => setGuestInfo({ ...guestInfo, phone: e.target.value })}
                    />
                    <Input
                      placeholder="Email (optional)"
                      value={guestInfo.email}
                      onChange={(e) => setGuestInfo({ ...guestInfo, email: e.target.value })}
                    />
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={() => setShowGuestForm(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by code, name, phone, email..."
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    {members.length > 0 && (
                      <div className="border rounded divide-y max-h-40 overflow-y-auto">
                        {members.map((m: any) => {
                          const info = getMemberDisplayInfo(m);
                          return (
                            <div
                              key={m.id}
                              className="p-2 hover:bg-muted cursor-pointer"
                              onClick={() => {
                                setSelectedMember(m);
                                setMemberSearch('');
                              }}
                            >
                              <p className="font-medium text-sm">{info.name}</p>
                              <div className="flex gap-3 text-xs text-muted-foreground">
                                {m.member_code && <span>{m.member_code}</span>}
                                {info.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{info.phone}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full text-muted-foreground"
                      onClick={() => setShowGuestForm(true)}
                    >
                      <UserPlus className="h-4 w-4 mr-2" />
                      Walk-in Guest
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Cart ({cart.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cart.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">Cart is empty</p>
                ) : (
                  <>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {cart.map((item) => (
                        <div key={item.product.id} className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{item.product.name}</p>
                            <p className="text-sm text-muted-foreground">₹{item.product.price}</p>
                            {item.product.requires_batch_tracking && (() => {
                              const info = batchMap.get(item.product.id);
                              if (!info) return <p className="text-[10px] text-destructive">No active batch</p>;
                              const expLabel = info.nextBatch.exp_date
                                ? new Date(info.nextBatch.exp_date).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
                                : '—';
                              return (
                                <p className={`text-[10px] ${info.expiringSoon ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                                  FEFO: {info.nextBatch.batch_number} · EXP {expLabel}
                                </p>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQuantity(item.product.id, -1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">{item.quantity}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQuantity(item.product.id, 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => removeFromCart(item.product.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      {/* Coupon code input */}
                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1.5">
                          <Tag className="h-3.5 w-3.5" />
                          Discount Code
                        </Label>
                        {appliedCoupon ? (
                          <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-success" />
                              <div className="text-sm">
                                <span className="font-mono font-semibold">{appliedCoupon.code}</span>
                                <span className="text-muted-foreground ml-2">
                                  {appliedCoupon.discount_type === 'percentage'
                                    ? `${appliedCoupon.discount_value}% off`
                                    : `₹${appliedCoupon.discount_value} off`}
                                </span>
                              </div>
                            </div>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={removeCoupon}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Input
                              placeholder="Enter coupon code"
                              value={couponInput}
                              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void validateCoupon(); } }}
                              className="h-9 font-mono uppercase"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void validateCoupon()}
                              disabled={couponValidating || !couponInput.trim() || cartSubtotal <= 0}
                            >
                              {couponValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Wallet status — always visible when a member is selected, so the
                          cashier knows the wallet exists. Toggle is only enabled when balance > 0. */}
                      {selectedMember && (
                        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
                          <div className="flex items-center gap-2">
                            <Wallet className="h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm font-medium">
                                {walletBalance > 0 ? 'Use Wallet' : 'Wallet'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Balance: ₹{Number(walletBalance).toLocaleString()}
                                {walletBalance <= 0 && <> — no credit available</>}
                                {useWallet && walletApplied > 0 && (
                                  <> — applying ₹{walletApplied.toLocaleString()}</>
                                )}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={useWallet}
                            onCheckedChange={setUseWallet}
                            disabled={walletBalance <= 0}
                          />
                        </div>
                      )}

                      {/* Totals breakdown */}
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Subtotal</span>
                          <span>₹{cartSubtotal.toLocaleString()}</span>
                        </div>
                        {couponDiscount > 0 && (
                          <div className="flex justify-between text-success">
                            <span>Discount {appliedCoupon?.code ? `(${appliedCoupon.code})` : ''}</span>
                            <span>−₹{couponDiscount.toLocaleString()}</span>
                          </div>
                        )}
                        {walletApplied > 0 && (
                          <div className="flex justify-between text-primary">
                            <span>Wallet redemption</span>
                            <span>−₹{walletApplied.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold pt-1.5 border-t">
                          <span>{walletApplied > 0 ? 'Due now' : 'Total'}</span>
                          <span>₹{remainderDue.toLocaleString()}</span>
                        </div>
                      </div>

                      {remainderDue > 0 ? (
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">💵 Cash</SelectItem>
                            <SelectItem value="card">💳 Credit / Debit Card</SelectItem>
                            <SelectItem value="upi">📱 UPI</SelectItem>
                            <SelectItem value="razorpay_link">🔗 Payment Link</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-primary text-center font-medium">
                          {walletApplied > 0 ? '✓ Fully covered by wallet' : '✓ No payment due'}
                        </div>
                      )}

                      {remainderDue > 0 && (paymentMethod === 'card' || paymentMethod === 'upi') && (
                        <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                          <div className="space-y-1">
                            <Label htmlFor="txn-id" className="text-xs">Transaction / Reference ID (optional)</Label>
                            <Input
                              id="txn-id"
                              placeholder="e.g. RZP12345 or UPI ref"
                              value={transactionId}
                              onChange={(e) => setTransactionId(e.target.value)}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="slip-upload" className="text-xs">Slip / Receipt Photo (optional)</Label>
                            <Input
                              id="slip-upload"
                              type="file"
                              accept="image/*"
                              onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
                              className="h-9 text-xs"
                            />
                            {slipFile && <p className="text-xs text-muted-foreground">📎 {slipFile.name}</p>}
                          </div>
                        </div>
                      )}

                      {paymentLinkUrl && (
                        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                          <p className="text-xs font-medium text-primary">Payment Link Generated</p>
                          <div className="flex items-center gap-2">
                            <Input value={paymentLinkUrl} readOnly className="text-xs" />
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => {
                                navigator.clipboard.writeText(paymentLinkUrl);
                                toast.success('Link copied!');
                              }}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Waiting for payment...
                          </div>
                        </div>
                      )}

                      <Button 
                        className="w-full" 
                        size="lg"
                        onClick={() => checkoutMutation.mutate()}
                        disabled={checkoutMutation.isPending}
                      >
                        <CreditCard className="mr-2 h-5 w-5" />
                        {checkoutMutation.isPending ? 'Processing...' : 'Complete Sale'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {todaySales.slice(0, 5).map((sale: any) => (
                    <div key={sale.id} className="flex justify-between items-center text-sm p-2 bg-muted/30 rounded">
                      <div>
                        <span className="text-muted-foreground">
                          {new Date(sale.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {sale.invoices?.invoice_number && (
                          <span className="ml-2 text-xs text-primary font-mono">{sale.invoices.invoice_number}</span>
                        )}
                      </div>
                      <span className="font-medium">₹{sale.total_amount}</span>
                    </div>
                  ))}
                  {todaySales.length === 0 && (
                    <p className="text-center py-4 text-muted-foreground text-sm">No sales today</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Invoice Drawer */}
      <ResponsiveSheet open={showInvoice} onOpenChange={setShowInvoice} width="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-success" />
            Sale Complete!
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Invoice has been created and payment recorded.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <div className="space-y-4 mt-4 flex-1">
          <div className="border rounded p-4 space-y-2">
            {lastSale?.items?.map((item: any) => (
              <div key={item.product.id} className="flex justify-between text-sm">
                <span>{item.product.name} x{item.quantity}</span>
                <span>₹{(item.product.price * item.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>Total</span>
              <span>₹{lastSale?.total?.toLocaleString()}</span>
            </div>
            {lastSale?.walletApplied > 0 && (
              <div className="flex justify-between text-sm text-primary">
                <span>₹{Number(lastSale.walletApplied).toLocaleString()} applied from wallet</span>
                <span>−₹{Number(lastSale.walletApplied).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Payment Method</span>
              <span className="capitalize">{lastSale?.paymentMethod}</span>
            </div>
          </div>
        </div>
        <ResponsiveSheetFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowInvoice(false)}>Close</Button>
          <Button variant="outline" onClick={() => navigate('/invoices')}>
            <FileText className="h-4 w-4 mr-2" />View Invoices
          </Button>
          <Button variant="outline" onClick={async () => {
            const memberPhone = lastSale?.member?.profiles?.phone || lastSale?.member?.phone || guestInfo.phone;
            if (!memberPhone || !effectiveBranchId || !lastSale?.invoice_id) {
              toast.error('Need a phone, branch and invoice to share');
              return;
            }
            try {
              const pdf = buildPaymentReceiptPdf({
                receipt_number: lastSale.invoices?.invoice_number || `RCPT-${lastSale.invoice_id?.slice(0, 8)}`,
                payment_date: new Date().toISOString(),
                amount: lastSale.total,
                payment_method: lastSale.paymentMethod || 'cash',
                transaction_id: lastSale.transaction_id,
                invoice_number: lastSale.invoices?.invoice_number,
                member_name: lastSale.member?.profiles?.full_name || guestInfo.name || 'Customer',
                member_code: lastSale.member?.member_code,
                branch_name: currentBranchName || 'Incline Fitness',
              });
              const r = await sendWhatsAppDocument({
                branchId: effectiveBranchId, phone: memberPhone,
                memberId: lastSale.member?.id || null,
                caption: `Receipt for ₹${lastSale.total} — Thank you!`,
                filename: `Receipt-${lastSale.invoice_id?.slice(0, 8)}.pdf`,
                pdf, folder: 'receipts',
              });
              if (r.status === 'failed' || r.status === 'suppressed') {
                throw new Error(r.status === 'suppressed' ? 'WhatsApp send was suppressed by preferences' : 'WhatsApp failed to send the PDF');
              }
              toast.success('Receipt PDF sent on WhatsApp');
            } catch (err: any) { toast.error(err?.message || 'Failed to send'); }
          }}>
            <MessageCircle className="h-4 w-4 mr-2" />Send PDF on WhatsApp
          </Button>
          <Button onClick={printInvoice}>
            <Receipt className="h-4 w-4 mr-2" />Print Receipt
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheet>
    </AppLayout>
  );
}
