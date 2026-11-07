export interface DeliveryState {
  status?: string | null;
  delivery_status?: string | null;
}

export function normalizeDeliveryStatus(log: DeliveryState): string {
  const status = (log.status || '').toLowerCase();
  const delivery = (log.delivery_status || '').toLowerCase();
  const terminal = ['failed', 'bounced', 'suppressed'];
  if (terminal.includes(delivery)) return delivery;
  if (terminal.includes(status)) return status;
  if (['delivered', 'read', 'replied'].includes(delivery)) return delivery;
  if (status === 'sent') return 'sent';
  if (delivery && delivery !== 'scheduled') return delivery;
  return status || 'pending';
}

export function deliveryStopped(status: string): boolean {
  return ['failed', 'bounced', 'suppressed'].includes(status);
}