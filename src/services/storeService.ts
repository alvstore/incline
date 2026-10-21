import { supabase } from '@/integrations/supabase/client';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  cost_price: number | null;
  category: string | null;
  sku: string | null;
  image_url: string | null;
  option_type?: string | null;
  option_value?: string | null;
  tax_rate: number | null;
  is_active: boolean | null;
  branch_id: string | null;
  requires_batch_tracking?: boolean | null;
  requires_lab_report?: boolean | null;
  default_shelf_life_days?: number | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export async function fetchProducts(branchId?: string) {
  let query = supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (branchId) {
    query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Product[];
}

export async function fetchProductsByCategory(category: string, branchId?: string) {
  let query = supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('category', category)
    .order('name');

  if (branchId) {
    query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Product[];
}

export async function createProduct(product: Omit<Product, 'id'>) {
  const { data, error } = await supabase
    .from('products')
    .insert(product)
    .select()
    .single();

  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, product: Partial<Product>) {
  const { data, error } = await supabase
    .from('products')
    .update(product)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Product;
}

/**
 * Create a POS sale.
 *
 * As of v2 this delegates to the authoritative `create_pos_sale` Postgres
 * RPC, which performs the entire checkout (sale + invoice + items + wallet
 * debit + remainder settlement + coupon usage + inventory) inside a single
 * transaction and routes payments through `settle_payment` for full
 * lifecycle/audit consistency.
 */
export async function createPOSSale(sale: {
  branchId: string;
  memberId?: string;
  items: CartItem[];
  paymentMethod: string;
  soldBy?: string;
  transactionId?: string;
  slipUrl?: string;
  /** Guest snapshot (used when no memberId) */
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  /** If true: invoice is created as `pending` with NO payment row. Webhook will settle. */
  awaitingPayment?: boolean;
  /** Optional flat discount amount (post-validation, e.g. coupon value). */
  discountAmount?: number;
  /** The coupon code (if any). */
  discountCodeId?: string;
  discountCode?: string;
  /** Wallet portion (₹) to apply against the bill. */
  walletApplied?: number;
  /** Optional client-supplied idempotency key for retry-safety. */
  idempotencyKey?: string;
}) {
  const items = sale.items.map((item) => ({
    product_id: item.product.id,
    name: item.product.name,
    quantity: item.quantity,
    unit_price: item.product.price,
    total: item.product.price * item.quantity,
  }));

  const { data, error } = await (supabase as any).rpc('create_pos_sale', {
    p_branch_id: sale.branchId,
    p_member_id: sale.memberId ?? null,
    p_items: items,
    p_payment_method: sale.paymentMethod,
    p_sold_by: sale.soldBy ?? null,
    p_guest_name: sale.guestName ?? null,
    p_guest_phone: sale.guestPhone ?? null,
    p_guest_email: sale.guestEmail ?? null,
    p_awaiting_payment: !!sale.awaitingPayment,
    p_discount_amount: sale.discountAmount ?? 0,
    p_discount_code_id: sale.discountCodeId ?? null,
    p_discount_code: sale.discountCode ?? null,
    p_wallet_applied: sale.walletApplied ?? 0,
    p_transaction_id: sale.transactionId ?? null,
    p_slip_url: sale.slipUrl ?? null,
    p_idempotency_key: sale.idempotencyKey ?? null,
  });

  if (error) {
    // Surface the *real* Postgres error so the user sees actionable detail
    // (e.g. "POS_VALIDATION: wallet_applied exceeds available balance" instead
    // of a generic 400). PostgrestError exposes message + details + hint + code.
    const detail = [error.message, (error as any).details, (error as any).hint]
      .filter(Boolean)
      .join(' — ');
    const enriched = new Error(detail || 'POS sale failed');
    (enriched as any).code = (error as any).code;
    (enriched as any).original = error;
    throw enriched;
  }
  const result = data as {
    pos_sale_id: string;
    invoice_id: string;
    subtotal: number;
    discount: number;
    wallet_applied: number;
    remainder: number;
    total: number;
    awaiting: boolean;
  };

  // Maintain the previous return shape so existing callers keep working.
  return {
    id: result.pos_sale_id,
    invoice_id: result.invoice_id,
    subtotal: result.subtotal,
    discount: result.discount,
    wallet_applied: result.wallet_applied,
    remainder: result.remainder,
    total_amount: result.total,
    payment_status: result.awaiting ? 'awaiting_payment' : 'paid',
  };
}

// (Legacy client-side POS checkout body removed — see create_pos_sale RPC.)

export async function createEcommerceOrder(order: {
  branchId: string;
  memberId: string;
  items: CartItem[];
  shippingAddress?: any;
}) {
  const subtotal = order.items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const taxAmount = subtotal * 0.18; // 18% GST
  const totalAmount = subtotal + taxAmount;

  const orderItems = order.items.map((item) => ({
    product_id: item.product.id,
    name: item.product.name,
    quantity: item.quantity,
    unit_price: item.product.price,
    total: item.product.price * item.quantity,
  }));

  // Generate order number
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

  const { data, error } = await supabase
    .from('ecommerce_orders')
    .insert({
      branch_id: order.branchId,
      member_id: order.memberId,
      order_number: orderNumber,
      items: orderItems,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      shipping_address: order.shippingAddress,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPOSSales(branchId: string, date?: string) {
  let query = supabase
    .from('pos_sales')
    .select(`
      *,
      members(member_code, profiles:user_id(full_name))
    `)
    .eq('branch_id', branchId)
    .order('sale_date', { ascending: false });

  if (date) {
    query = query.gte('sale_date', `${date}T00:00:00`).lte('sale_date', `${date}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';

export async function fetchEcommerceOrders(branchId: string, status?: OrderStatus) {
  let query = supabase
    .from('ecommerce_orders')
    .select(`
      *,
      members(member_code, profiles:user_id(full_name))
    `)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateOrderStatus(orderId: string, status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned') {
  const { data, error } = await supabase
    .from('ecommerce_orders')
    .update({ status })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
