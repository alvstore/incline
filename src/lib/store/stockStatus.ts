// Single stock rule for desk POS and Member Store.
// A sellable item without a stock row for the branch has nothing on the shelf (0), never "unlimited".

export interface InventoryRow {
  quantity: number | null;
  branch_id: string;
  min_quantity?: number | null;
}

export interface StockInput {
  requires_batch_tracking?: boolean | null;
  inventory?: InventoryRow[] | null;
}

export function stockFor(product: StockInput, branchId: string | null | undefined, batchQty?: number): number {
  if (product.requires_batch_tracking) return Math.max(0, batchQty ?? 0);
  const row = (product.inventory ?? []).find((i) => i.branch_id === branchId);
  return Math.max(0, row?.quantity ?? 0);
}

export function minStockFor(product: StockInput, branchId: string | null | undefined): number {
  return (product.inventory ?? []).find((i) => i.branch_id === branchId)?.min_quantity ?? 5;
}

export type StockState = 'out' | 'low' | 'in';

export function stockState(qty: number, min = 5): StockState {
  if (qty <= 0) return 'out';
  if (qty < min) return 'low';
  return 'in';
}

/** Total across a product's options (a parent card is out of stock only when every option is). */
export function groupStock(quantities: number[]): number {
  return quantities.reduce((s, q) => s + Math.max(0, q), 0);
}
