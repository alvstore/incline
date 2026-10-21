/** Age alone never invalidates a successful push; only matching state can skip. */
export function canReuseGatePush(
  stateSig: string | undefined,
  previous: { sig: string | null; at: string } | undefined,
  fullSyncAt: string | null | undefined,
  force: boolean,
): boolean {
  return !force && Boolean(stateSig) && previous?.sig === stateSig
    && !(fullSyncAt && previous && fullSyncAt > previous.at);
}

/** Internal repair events use the same explicit bypass as the staff repair UI. */
export function isGateRepair(force: unknown, changedFields: unknown): boolean {
  if (force === true) return true;
  if (!changedFields || typeof changedFields !== "object") return false;
  return "manual_repush" in changedFields && changedFields.manual_repush === true;
}