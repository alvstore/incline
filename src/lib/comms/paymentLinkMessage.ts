import { dispatchCommunication, buildDedupeKey } from '@/lib/comms/dispatch';

/** Reusable WhatsApp payment-link send. Uses the Meta UTILITY template bound to
 *  `payment_link_sent`, so it works outside the 24-hour chat window. */
export async function sendPaymentLinkWhatsApp(args: {
  branchId: string;
  phone: string;
  memberName?: string | null;
  amount: number;
  purpose?: string | null;
  reference: string;
  link: string;
  dedupeParts: (string | number)[];
}) {
  const amount = args.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const ordered: [string, string][] = [
    ['member_name', args.memberName || 'Member'],
    ['amount', amount],
    ['payment_purpose', args.purpose || `invoice ${args.reference}`],
    ['invoice_number', args.reference],
    ['payment_link', args.link],
  ];
  const variables: Record<string, string> = { event_key: 'payment_link_sent' };
  ordered.forEach(([k, v], i) => { variables[k] = v; variables[String(i + 1)] = v; variables[`variable_${i + 1}`] = v; });
  return dispatchCommunication({
    branch_id: args.branchId,
    channel: 'whatsapp',
    category: 'payment_alert',
    recipient: args.phone,
    payload: {
      body: `Hi ${ordered[0][1]}, your payment of ₹${amount} for ${ordered[2][1]} (ref ${args.reference}) is ready. You can pay securely using this link: ${args.link}`,
      variables,
    },
    dedupe_key: buildDedupeKey(['paylink', ...args.dedupeParts, 'wa']),
    force: true,
  } as any);
}
