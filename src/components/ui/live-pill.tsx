/**
 * Subtle "Live" indicator. Use in page headers next to a title so users know
 * the data updates in real-time without manual refresh.
 */
export function LivePill({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success ${className}`}
      aria-label="Live updates active"
      title="Live — updates instantly"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      Live
    </span>
  );
}
