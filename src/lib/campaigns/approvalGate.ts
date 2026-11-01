export function campaignNeedsApproval(campaign: { approval_required?: boolean; approved_at?: string | null }): boolean {
  return campaign.approval_required === true && !campaign.approved_at;
}