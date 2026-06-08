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

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Store</h1>
            <p className="text-muted-foreground">Browse and purchase products</p>
          </div>
          {cartCount > 0 && (
            <Badge variant="default" className="text-lg px-4 py-2">
              <ShoppingCart className="h-5 w-5 mr-2" />
              {cartCount} items • ₹{cartTotal.toLocaleString()}
            </Badge>
          )}
        </div>

        {/* Unclaimed Rewards Banner */}
        {unclaimedRewards.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Gift className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <p className="font-medium">You have {unclaimedRewards.length} unclaimed referral reward{unclaimedRewards.length > 1 ? 's' : ''}!</p>
                  <p className="text-sm text-muted-foreground">Redeem to add credits to your wallet</p>
                </div>
                <div className="flex gap-2">
                  {unclaimedRewards.slice(0, 3).map(reward => (
                    <Button
                      key={reward.id}
                      size="sm"
                      variant="outline"
                      onClick={() => claimReward.mutate(reward.id)}
                      disabled={claimReward.isPending}
                    >
                      <Gift className="h-3 w-3 mr-1" />
                      Redeem ₹{reward.reward_value}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add-Ons banner — service add-ons live in their own flow, separate from products */}
        <Card className="border-primary/30 bg-gradient-to-r from-primary/10 to-primary/10">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/15 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Need extra sessions or PT?</p>
                <p className="text-xs text-muted-foreground">Buy benefit credits or a PT package — separate from products.</p>
              </div>
            </div>
            <Button onClick={() => setAddOnOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Buy Add-Ons
            </Button>
          </CardContent>
        </Card>

        <h2 className="text-xl font-semibold pt-2">Products</h2>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Products Grid */}
          <div className="md:col-span-2">
            {filteredProducts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No products found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {filteredProducts.map((product: any) => {
                  const stockInfo = getStockDisplay(product);
                  const cartItem = cart.find(item => item.product.id === product.id);
                  const maxQty = stockInfo.stock ?? 999;

                  return (
                    <Card key={product.id} className="border-border/50">
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-20 h-20 object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-muted rounded-lg flex items-center justify-center">
                              <Package className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1">
                            <h3 className="font-semibold">{product.name}</h3>
                            <p className="text-sm text-muted-foreground">{product.category?.name}</p>
                            <p className="text-lg font-bold text-accent mt-1">₹{product.price}</p>
                            <p className={`text-xs ${stockInfo.canAdd ? 'text-muted-foreground' : 'text-destructive'}`}>
                              {stockInfo.text}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4">
                          {cartItem ? (
                            <div className="flex items-center justify-between">
                              <Button variant="outline" size="icon" onClick={() => updateQuantity(product.id, -1)}>
                                <Minus className="h-4 w-4" />
                              </Button>
                              <span className="font-semibold">{cartItem.quantity}</span>
                              <Button variant="outline" size="icon" onClick={() => updateQuantity(product.id, 1)} disabled={cartItem.quantity >= maxQty}>
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button className="w-full" onClick={() => addToCart(product)} disabled={!stockInfo.canAdd}>
                              {stockInfo.canAdd ? 'Add to Cart' : 'Out of Stock'}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cart & Checkout */}
          <div className="space-y-4">
            <Card className="border-border/50 sticky top-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Your Cart
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cart.length === 0 ? (
                  <div className="text-center py-8">
                    <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">Your cart is empty</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Cart Items */}
                    {cart.map((item) => (
                      <div key={item.product.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-sm text-muted-foreground">
                            ₹{item.product.price} × {item.quantity}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">₹{(item.product.price * item.quantity).toLocaleString()}</p>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeFromCart(item.product.id)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}

                    {/* Promo Code */}
                    <div className="border-t pt-4 space-y-3">
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Tag className="h-4 w-4" /> Promo Code
                      </p>
                      {appliedDiscount ? (
                        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
                          <div>
                            <p className="text-sm font-medium text-primary">{appliedDiscount.code}</p>
                            <p className="text-xs text-muted-foreground">
                              {appliedDiscount.type === 'percentage' ? `${appliedDiscount.value}% off` : `₹${appliedDiscount.value} off`}
                            </p>
                          </div>
                          <Button variant="ghost" size="sm" onClick={removePromo}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter code"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                            className="flex-1"
                          />
                          <Button variant="outline" onClick={applyPromoCode} disabled={applyingPromo || !promoCode.trim()}>
                            {applyingPromo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Wallet Balance */}
                    {walletBalance > 0 && (
                      <div className="border-t pt-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <Checkbox
                            checked={useWalletBalance}
                            onCheckedChange={(checked) => setUseWalletBalance(!!checked)}
                          />
                          <div className="flex items-center gap-2 flex-1">
                            <Wallet className="h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm font-medium">Use Wallet Balance</p>
                              <p className="text-xs text-muted-foreground">₹{walletBalance.toLocaleString()} available</p>
                            </div>
                          </div>
                          {useWalletBalance && (
                            <span className="text-sm font-medium text-primary">-₹{walletDeduction.toLocaleString()}</span>
                          )}
                        </label>
                      </div>
                    )}

                    {/* Order Summary */}
                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>₹{cartTotal.toLocaleString()}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-sm text-primary">
                          <span>Discount ({appliedDiscount?.code})</span>
                          <span>-₹{discountAmount.toLocaleString()}</span>
                        </div>
                      )}
                      {walletDeduction > 0 && (
                        <div className="flex justify-between text-sm text-primary">
                          <span>Wallet</span>
                          <span>-₹{walletDeduction.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-lg font-bold pt-2 border-t">
                        <span>{finalAmount <= 0 ? 'Amount Due' : 'To Pay'}</span>
                        <span className={finalAmount <= 0 ? 'text-success' : ''}>
                          {finalAmount <= 0 ? 'Fully Covered' : `₹${finalAmount.toLocaleString()}`}
                        </span>
                      </div>
                    </div>

                    <Button 
                      className="w-full" 
                      size="lg"
                      onClick={() => checkout.mutate()}
                      disabled={checkout.isPending}
                    >
                      {checkout.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          {finalAmount <= 0 ? 'Place Order (Paid)' : 'Place Order'}
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-center text-muted-foreground">
                      {finalAmount <= 0
                        ? 'Order will be marked as paid automatically.'
                        : 'You will be redirected to a secure online payment page after placing your order.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

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
