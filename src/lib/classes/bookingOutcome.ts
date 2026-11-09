export type BookingOutcome =
  | { kind: 'booked'; invoiceId?: string | null }
  | { kind: 'already_booked' }
  | { kind: 'unknown' }
  | { kind: 'failed'; message: string };

interface BookResult { success?: boolean; code?: string; error?: string; already_booked?: boolean; invoice_id?: string | null }

/** Map a book_class response (or a transport error) to what the member should see. */
export function bookingOutcome(result: unknown, transportError?: unknown): BookingOutcome {
  if (transportError) {
    const msg = transportError instanceof Error ? transportError.message : String(transportError ?? '');
    // Server rejected and rolled back: definite failure, safe to retry.
    if (/invoice_failed/i.test(msg)) return { kind: 'failed', message: 'We could not create the invoice for this class, so nothing was booked. Please try again.' };
    // Network/timeouts: the server may have booked it.
    return { kind: 'unknown' };
  }
  const r = (result ?? {}) as BookResult;
  if (r.already_booked || r.code === 'already_booked') return { kind: 'already_booked' };
  if (r.success) return { kind: 'booked', invoiceId: r.invoice_id ?? null };
  if (r.code === 'class_full') return { kind: 'failed', message: 'This class is full. You can join the waitlist.' };
  return { kind: 'failed', message: r.error || 'Booking failed. Please try again.' };
}
