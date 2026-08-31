import { isPacingError } from '@/lib/comms/metaErrorLabels';

export type CampaignDeliveryStatus =
  | 'read' | 'delivered' | 'sent' | 'failed' | 'pace_limited' | 'pending' | 'skipped';

export type CampaignDeliveryCounts = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pace_limited: number;
  pending: number;
  skipped: number;
};

export type DeliveryStatusInput = {
  recipientStatus?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  /** Raw provider error text — used to detect Meta pacing (131049 / 130472). */
  errorText?: string | null;
};

export const normalizeCampaignDeliveryStatus = ({
  recipientStatus,
  deliveryStatus,
  deliveredAt,
  readAt,
  errorText,
}: DeliveryStatusInput): CampaignDeliveryStatus => {
  const recipient = String(recipientStatus || '').toLowerCase();
  const delivery = String(deliveryStatus || '').toLowerCase();
  if (readAt || delivery === 'read' || recipient === 'read') return 'read';
  if (deliveredAt || delivery === 'delivered' || recipient === 'delivered') return 'delivered';
  if (recipient === 'pace_limited' || delivery === 'pace_limited') return 'pace_limited';
  if (delivery === 'failed' || delivery === 'bounced' || recipient === 'failed') {
    // Meta pacing is not a delivery failure — it is a withheld marketing send.
    return isPacingError(errorText) ? 'pace_limited' : 'failed';
  }
  if (recipient === 'skipped' || recipient === 'suppressed' || delivery === 'suppressed' || delivery === 'deduped') return 'skipped';
  if (recipient === 'sent' || recipient === 'submitted' || delivery === 'sent') return 'sent';
  return 'pending';
};

export const campaignDeliveryRank = (status?: string | null) => {
  switch (String(status || '').toLowerCase()) {
    case 'read': return 7;
    case 'delivered': return 6;
    case 'sent':
    case 'submitted': return 5;
    case 'failed':
    case 'bounced': return 4;
    case 'pace_limited': return 3;
    case 'skipped':
    case 'suppressed': return 2;
    default: return 1;
  }
};

export const deriveCampaignDeliveryCounts = (
  rows: Array<{ final: CampaignDeliveryStatus }>,
): CampaignDeliveryCounts => {
  const counts: CampaignDeliveryCounts = {
    total: rows.length,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    pace_limited: 0,
    pending: 0,
    skipped: 0,
  };
  for (const row of rows) {
    if (row.final === 'read') { counts.read++; counts.delivered++; counts.sent++; }
    else if (row.final === 'delivered') { counts.delivered++; counts.sent++; }
    else if (row.final === 'sent') counts.sent++;
    else if (row.final === 'failed') counts.failed++;
    else if (row.final === 'pace_limited') counts.pace_limited++;
    else if (row.final === 'skipped') counts.skipped++;
    else counts.pending++;
  }
  return counts;
};

export type CampaignDeliveryFilter = 'all' | CampaignDeliveryStatus;

export const campaignDeliveryFilterMatches = (
  filter: CampaignDeliveryFilter,
  status: CampaignDeliveryStatus,
) => {
  if (filter === 'all') return true;
  if (filter === 'sent') return status === 'sent' || status === 'delivered' || status === 'read';
  if (filter === 'delivered') return status === 'delivered' || status === 'read';
  return filter === status;
};

export const campaignDeliveryFilterLabel = (filter: CampaignDeliveryFilter) =>
  filter === 'pace_limited'
    ? 'Pace limited'
    : filter.charAt(0).toUpperCase() + filter.slice(1);
