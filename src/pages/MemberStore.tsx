import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useMemberData } from '@/hooks/useMemberData';
import { useWallet } from '@/hooks/useWallet';
import { ShoppingBag, Search, Package, AlertCircle, Loader2, Plus, Minus, ShoppingCart, Check, Tag, Wallet, Gift, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useStableIdempotencyKey } from '@/hooks/useStableIdempotencyKey';
import { hashCart } from '@/lib/cartHash';
import { PurchaseAddOnDrawer } from '@/components/benefits/PurchaseAddOnDrawer';


interface CartItem {
  product: any;
  quantity: number;
}

interface AppliedDiscount {
  id: string;
  code: string;
  type: string;
  value: number;
  discountAmount: number;
}

export default function MemberStore() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { member, activeMembership, isLoading: memberLoading } = useMemberData();
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [addOnOpen, setAddOnOpen] = useState(false);

  // Wallet data
  const { data: wallet } = useWallet(member?.id || '');
  const walletBalance = wallet?.balance || 0;

  // Fetch unclaimed referral rewards
  const { data: unclaimedRewards = [] } = useQuery({
    queryKey: ['unclaimed-rewards', member?.id],
    enabled: !!member?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_rewards')
        .select('*')
        .eq('member_id', member!.id)
        .eq('is_claimed', false);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch products
  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['store-products', member?.branch_id],
    enabled: !!member,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          *,
          category:product_categories(id, name),
          inventory(quantity, branch_id)
        `)
        .eq('is_active', true);

      if (error) throw error;
      
      return (data || []).map(product => ({
        ...product,
        inventory: product.inventory?.filter((inv: any) => inv.branch_id === member!.branch_id) || []
      }));
    },
  });

  const filteredProducts = products.filter((p: any) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    toast.success(`${product.name} added to cart`);
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev =>
      prev.map(item => {
        if (item.product.id === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : item;
        }
        return item;
      }).filter(item => item.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Calculate discounts
  const discountAmount = appliedDiscount?.discountAmount || 0;
  const afterDiscount = Math.max(0, cartTotal - discountAmount);
  const walletDeduction = useWalletBalance ? Math.min(walletBalance, afterDiscount) : 0;
  const finalAmount = Math.max(0, afterDiscount - walletDeduction);

  // Apply promo code via authoritative server-side validator (no client-trust math).
  const applyPromoCode = async () => {
    if (!promoCode.trim()) return;
    setApplyingPromo(true);
    try {
      const { validateCoupon, couponReasonLabel } = await import('@/services/couponService');
      const result = await validateCoupon({
        code: promoCode.trim().toUpperCase(),
        branchId: member?.branch_id ?? null,
        subtotal: cartTotal,
      });
      if (!result.success) {
        const failure = result as { success: false; reason: string; min_purchase?: number };
        if (failure.reason === 'min_purchase' && failure.min_purchase) {
          toast.error(`Minimum purchase of ₹${failure.min_purchase} required`);
        } else {
          toast.error(couponReasonLabel(failure.reason));
        }
        return;
      }
      setAppliedDiscount({
        id: result.code_id,
        code: result.code,
        type: result.discount_type,
        value: result.discount_value,
        discountAmount: result.discount_amount,
      });
      toast.success(`Promo code "${result.code}" applied!`);
    } catch {
      toast.error('Failed to validate promo code');
    } finally {
      setApplyingPromo(false);
    }
  };

  const removePromo = () => {
    setAppliedDiscount(null);
    setPromoCode('');
  };

  // Claim referral reward — single canonical path through referralService.
  const claimReward = useMutation({
    mutationFn: async (rewardId: string) => {
      const { claimReward: claimRewardSvc } = await import('@/services/referralService');
      return claimRewardSvc(rewardId, member!.id);
    },
    onSuccess: () => {
      toast.success('Reward credited to your wallet!');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['unclaimed-rewards'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to redeem reward'),
  });

  // Stable idempotency key for store checkout — refreshes only when cart/promo/wallet flag changes.
  const cartSignature = hashCart({
    items: cart.map((c) => ({ id: c.product.id, quantity: c.quantity, unitPrice: Number(c.product.price) })),
    promoCode: appliedDiscount?.code,
    walletApplied: useWalletBalance ? walletDeduction : 0,
  });
  const checkoutIdemKey = useStableIdempotencyKey(member?.id, 'member_store_checkout', cartSignature);

  // Atomic checkout via create_pos_sale RPC (handles wallet, promo usage, invoice, items, GST in one transaction).
  // For amounts due online, we then hand off to the configured payment gateway via the
  // create-razorpay-link edge function so members never have to "pay at the front desk".
  const checkout = useMutation({
    mutationFn: async () => {
      if (!member || cart.length === 0) throw new Error('Cart is empty');

      // create_pos_sale computes subtotal from each item's `total`, and writes
      // `name` into invoice_items.description — both fields are required.
      const items = cart.map((item) => {
        const unitPrice = Number(item.product.price);
        return {
          product_id: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          unit_price: unitPrice,
          total: unitPrice * item.quantity,
        };
      });

      const isAwaiting = finalAmount > 0;

      const { data, error } = await supabase.rpc('create_pos_sale', {
        p_branch_id: member.branch_id,
        p_member_id: member.id,
        p_items: items,
        p_payment_method: isAwaiting ? 'upi' : 'wallet',
        p_sold_by: member.user_id ?? null,
        p_awaiting_payment: isAwaiting,
        p_discount_amount: discountAmount,
        p_discount_code_id: appliedDiscount?.id ?? null,
        p_discount_code: appliedDiscount?.code ?? null,
        p_wallet_applied: walletDeduction,
        p_idempotency_key: checkoutIdemKey,
      });

      if (error) throw new Error(error.message || 'Checkout failed');
      const result = (data as any) || {};
      const invoiceId: string | undefined = result.invoice_id;

      // Wallet covered everything — done.
      if (!isAwaiting) {
        return { invoiceId, awaiting: false };
      }

      // Online payment due → return invoiceId; UI navigates to /member/pay
      if (!invoiceId) throw new Error('Invoice was not created');
      return { invoiceId, awaiting: true };
    },
    onSuccess: ({ invoiceId, awaiting }) => {
      setCart([]);
      setAppliedDiscount(null);
      setPromoCode('');
      setUseWalletBalance(false);
      queryClient.invalidateQueries({ queryKey: ['member-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['my-pending-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['store-products'] });

      if (awaiting && invoiceId) {
        toast.success('Order placed. Continue to secure checkout…');
        navigate(`/member/pay?invoice=${invoiceId}`);
      } else {
        toast.success('Order placed & paid via wallet!');
        navigate('/my-invoices');
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to place order');
    },
  });

  if (memberLoading || productsLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!member) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
          <AlertCircle className="h-12 w-12 text-warning" />
          <h2 className="text-xl font-semibold">No Member Profile Found</h2>
        </div>
      </AppLayout>
    );
  }

  const getStockDisplay = (product: any) => {
    const hasInventory = product.inventory && product.inventory.length > 0;
    const stock = hasInventory ? product.inventory[0].quantity : null;
    
    if (!hasInventory) {
      return { text: 'Available', canAdd: true, stock: null };
    }
    if (stock === 0) {
      return { text: 'Out of Stock', canAdd: false, stock: 0 };
    }
    return { text: `${stock} in stock`, canAdd: true, stock };
  };

  const categories: string[] = Array.from(
    new Set(products.map((p: any) => p.category?.name).filter(Boolean)),
  ) as string[];

  const visibleProducts = filteredProducts.filter(
    (p: any) => activeCategory === 'all' || p.category?.name === activeCategory,
  );

  const CartBody = () => (
    <div className="space-y-4">
      {cart.map((item) => (
        <div key={item.product.id} className="flex items-start justify-between gap-3 rounded-xl bg-muted/40 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.product.name}</p>
            <p className="text-xs text-muted-foreground">₹{item.product.price} × {item.quantity}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums">₹{(item.product.price * item.quantity).toLocaleString()}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={() => removeFromCart(item.product.id)}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}

      {/* Promo Code */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Promo code
        </p>
        {appliedDiscount ? (
          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-primary">{appliedDiscount.code}</p>
              <p className="text-xs text-muted-foreground">
                {appliedDiscount.type === 'percentage' ? `${appliedDiscount.value}% off` : `₹${appliedDiscount.value} off`}
              </p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Remove promo code" onClick={removePromo}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <label htmlFor="promo-code" className="sr-only">Promo code</label>
            <Input
              id="promo-code"
              placeholder="Enter code"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              className="flex-1 rounded-xl"
            />
            <Button variant="outline" className="rounded-xl" onClick={applyPromoCode} disabled={applyingPromo || !promoCode.trim()}>
              {applyingPromo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </Button>
          </div>
        )}
      </div>

      {/* Wallet */}
      {walletBalance > 0 && (
        <div className="border-t border-border/60 pt-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-muted/40 p-3">
            <Checkbox checked={useWalletBalance} onCheckedChange={(checked) => setUseWalletBalance(!!checked)} />
            <span className="flex flex-1 items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium">Use wallet balance</span>
                <span className="block text-xs text-muted-foreground">₹{walletBalance.toLocaleString()} available</span>
              </span>
            </span>
            {useWalletBalance && (
              <span className="text-sm font-semibold text-primary">-₹{walletDeduction.toLocaleString()}</span>
            )}
          </label>
        </div>
      )}

      {/* Summary */}
      <div className="space-y-2 border-t border-border/60 pt-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">₹{cartTotal.toLocaleString()}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-sm text-primary">
            <span>Discount ({appliedDiscount?.code})</span>
            <span className="tabular-nums">-₹{discountAmount.toLocaleString()}</span>
          </div>
        )}
        {walletDeduction > 0 && (
          <div className="flex justify-between text-sm text-primary">
            <span>Wallet</span>
            <span className="tabular-nums">-₹{walletDeduction.toLocaleString()}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border/60 pt-2 text-lg font-bold">
          <span>{finalAmount <= 0 ? 'Amount due' : 'To pay'}</span>
          <span className={finalAmount <= 0 ? 'text-success' : ''}>
            {finalAmount <= 0 ? 'Fully covered' : `₹${finalAmount.toLocaleString()}`}
          </span>
        </div>
      </div>

      <Button
        className="w-full rounded-xl"
        size="lg"
        onClick={() => checkout.mutate()}
        disabled={checkout.isPending}
      >
        {checkout.isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</>
        ) : (
          <><Check className="mr-2 h-4 w-4" />{finalAmount <= 0 ? 'Place order (paid)' : 'Place order'}</>
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {finalAmount <= 0
          ? 'Order will be marked as paid automatically.'
          : 'You will be redirected to a secure online payment page after placing your order.'}
      </p>
    </div>
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-5 pb-24 md:pb-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-accent p-6 text-primary-foreground shadow-lg shadow-primary/20">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary-foreground/10 blur-2xl" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
                <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
                Member store
              </span>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Shop supplements & gear</h1>
              <p className="text-sm text-primary-foreground/80">
                Pay with your wallet, apply promo codes, and pick up at the front desk.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:w-64">
              <div className="rounded-xl bg-primary-foreground/10 px-3 py-2 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-wider text-primary-foreground/70">Wallet</p>
                <p className="text-lg font-bold tabular-nums">₹{walletBalance.toLocaleString()}</p>
              </div>
              <div className="rounded-xl bg-primary-foreground/10 px-3 py-2 backdrop-blur-sm">
                <p className="text-[10px] uppercase tracking-wider text-primary-foreground/70">Cart</p>
                <p className="text-lg font-bold tabular-nums">{cartCount} item{cartCount === 1 ? '' : 's'}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Unclaimed rewards */}
        {unclaimedRewards.length > 0 && (
          <Card className="rounded-2xl border-primary/20 bg-primary/5 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Gift className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-semibold">
                  {unclaimedRewards.length} unclaimed referral reward{unclaimedRewards.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-muted-foreground">Redeem to add credits to your wallet</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {unclaimedRewards.slice(0, 3).map((reward) => (
                  <Button
                    key={reward.id}
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => claimReward.mutate(reward.id)}
                    disabled={claimReward.isPending}
                  >
                    <Gift className="mr-1 h-3.5 w-3.5" />
                    Redeem ₹{reward.reward_value}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add-ons */}
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold">Need extra sessions or PT?</p>
                <p className="text-xs text-muted-foreground">Buy benefit credits or a PT package — separate from products.</p>
              </div>
            </div>
            <Button className="rounded-xl" onClick={() => setAddOnOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Buy add-ons
            </Button>
          </CardContent>
        </Card>

        {/* Search + categories */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="store-search" className="sr-only">Search products</label>
            <Input
              id="store-search"
              placeholder="Search products…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xl pl-10"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {['all', ...categories].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    activeCategory === cat
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {cat === 'all' ? 'All products' : cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Products */}
          <div className="lg:col-span-2">
            {visibleProducts.length === 0 ? (
              <Card className="rounded-2xl border-border/60">
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                    <Package className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <p className="text-sm text-muted-foreground">No products found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleProducts.map((product: any) => {
                  const stockInfo = getStockDisplay(product);
                  const cartItem = cart.find((item) => item.product.id === product.id);
                  const maxQty = stockInfo.stock ?? 999;

                  return (
                    <Card
                      key={product.id}
                      className="group overflow-hidden rounded-2xl border-border/60 shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-primary/10"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Package className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
                          </div>
                        )}
                        <Badge
                          className={`absolute left-3 top-3 rounded-full text-[11px] ${
                            stockInfo.canAdd
                              ? 'border-transparent bg-success/15 text-success'
                              : 'border-transparent bg-destructive/15 text-destructive'
                          }`}
                        >
                          {stockInfo.text}
                        </Badge>
                      </div>
                      <CardContent className="space-y-3 p-4">
                        <div className="space-y-0.5">
                          {product.category?.name && (
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {product.category.name}
                            </p>
                          )}
                          <h3 className="truncate text-sm font-semibold">{product.name}</h3>
                          <p className="text-xl font-bold">₹{Number(product.price).toLocaleString()}</p>
                        </div>
                        {cartItem ? (
                          <div className="flex items-center justify-between rounded-xl bg-muted/50 p-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove one ${product.name}`}
                              onClick={() => updateQuantity(product.id, -1)}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="text-sm font-semibold tabular-nums">{cartItem.quantity}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Add one ${product.name}`}
                              onClick={() => updateQuantity(product.id, 1)}
                              disabled={cartItem.quantity >= maxQty}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            className="w-full rounded-xl"
                            onClick={() => addToCart(product)}
                            disabled={!stockInfo.canAdd}
                          >
                            {stockInfo.canAdd ? 'Add to cart' : 'Out of stock'}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop cart */}
          <aside className="hidden lg:block">
            <Card className="sticky top-4 rounded-2xl border-border/60 shadow-lg shadow-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                  Your cart
                  {cartCount > 0 && (
                    <Badge className="ml-auto rounded-full bg-primary/10 text-primary">{cartCount}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <ShoppingBag className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <p className="text-sm text-muted-foreground">Your cart is empty</p>
                  </div>
                ) : (
                  <CartBody />
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      {/* Mobile sticky cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 p-3 pb-safe backdrop-blur lg:hidden">
          <Button className="h-12 w-full rounded-xl" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            View cart • {cartCount} item{cartCount === 1 ? '' : 's'} • ₹{cartTotal.toLocaleString()}
          </Button>
        </div>
      )}

      {/* Mobile cart drawer */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border/60 px-6 py-4 text-left">
            <SheetTitle>Your cart</SheetTitle>
            <SheetDescription>Review your items and check out securely.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {cart.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Your cart is empty</p>
            ) : (
              <CartBody />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <PurchaseAddOnDrawer
        open={addOnOpen}
        onOpenChange={setAddOnOpen}
        memberId={member.id}
        memberName={(member as any).profiles?.full_name}
        membershipId={activeMembership?.id ?? null}
        branchId={member.branch_id}
        mode="member"
      />
    </AppLayout>
  );
}

