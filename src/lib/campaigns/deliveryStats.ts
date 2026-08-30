export type CampaignDeliveryStatus = 'read' | 'delivered' | 'sent' | 'failed' | 'pending' | 'skipped';

export type CampaignDeliveryCounts = {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  skipped: number;
};

export type DeliveryStatusInput = {
  recipientStatus?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
};

export const normalizeCampaignDeliveryStatus = ({
  recipientStatus,
  deliveryStatus,
  deliveredAt,
  readAt,
}: DeliveryStatusInput): CampaignDeliveryStatus => {
  const recipient = String(recipientStatus || '').toLowerCase();
  const delivery = String(deliveryStatus || '').toLowerCase();
  if (readAt || delivery === 'read' || recipient === 'read') return 'read';
  if (deliveredAt || delivery === 'delivered' || recipient === 'delivered') return 'delivered';
  if (delivery === 'failed' || delivery === 'bounced' || recipient === 'failed') return 'failed';
  if (recipient === 'skipped' || recipient === 'suppressed' || delivery === 'suppressed' || delivery === 'deduped') return 'skipped';
  if (recipient === 'sent' || recipient === 'submitted' || delivery === 'sent') return 'sent';
  return 'pending';
};

export const campaignDeliveryRank = (status?: string | null) => {
  switch (String(status || '').toLowerCase()) {
    case 'read': return 6;
    case 'delivered': return 5;
    case 'sent':
    case 'submitted': return 4;
    case 'failed':
    case 'bounced': return 3;
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
    pending: 0,
    skipped: 0,
  };
  for (const row of rows) {
    if (row.final === 'read') { counts.read++; counts.delivered++; counts.sent++; }
    else if (row.final === 'delivered') { counts.delivered++; counts.sent++; }
    else if (row.final === 'sent') counts.sent++;
    else if (row.final === 'failed') counts.failed++;
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