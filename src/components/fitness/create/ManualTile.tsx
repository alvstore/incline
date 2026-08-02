interface ManualTileProps {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
  /** Optional secondary affordance, e.g. "Start from template". */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Large tap target for the manual workout / diet entry points. */
export function ManualTile({
  icon,
  title,
  hint,
  onClick,
  secondaryLabel,
  onSecondary,
}: ManualTileProps) {
  return (
    <div className="group flex min-h-[112px] flex-col rounded-xl bg-muted/40 ring-1 ring-border transition-all duration-200 hover:bg-muted/70 hover:ring-primary/30 motion-reduce:transition-none">
      <button
        onClick={onClick}
        aria-label={title}
        className="flex flex-1 cursor-pointer flex-col items-start gap-1.5 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon}
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </button>
      {secondaryLabel && onSecondary && (
        <button
          onClick={onSecondary}
          className="mx-4 mb-3 w-fit cursor-pointer rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
