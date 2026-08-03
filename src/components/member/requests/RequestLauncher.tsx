import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';
import type { RequestOption, RequestKind } from './requestTypes';

interface RequestLauncherProps {
  options: RequestOption[];
  onSelect: (kind: RequestKind) => void;
}

export function RequestLauncher({ options, onSelect }: RequestLauncherProps) {
  return (
    <Card className="rounded-2xl border-border/60 shadow-lg shadow-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Request something</CardTitle>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pick a service — the team responds within a day
        </p>
      </CardHeader>
      <CardContent className="p-2">
        <div className="divide-y divide-border/50">
          {options.map((option) => {
            const Icon = option.icon;
            const disabled = !!option.disabledReason;
            return (
              <button
                key={option.kind}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(option.kind)}
                data-testid={`request-option-${option.kind}`}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary ${
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-muted/60'
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${option.tone}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {option.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.disabledReason || option.description}
                  </span>
                </span>
                {!disabled && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
