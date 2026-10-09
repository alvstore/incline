import { format } from 'date-fns';
import { Gift, QrCode, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getBenefitIcon } from '@/lib/benefitIcons';
import type { MemberEntitlement } from '@/lib/benefits/memberEntitlements';

interface MemberEntitlementGridProps {
  entitlements: MemberEntitlement[];
  frozen?: boolean;
}

export function MemberEntitlementGrid({ entitlements, frozen = false }: MemberEntitlementGridProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
      {entitlements.map((entitlement) => {
        const Icon = getBenefitIcon(entitlement.icon || entitlement.code);
        const remainingPercent = entitlement.remaining === null || entitlement.total === null
          ? 100
          : entitlement.total > 0
            ? (entitlement.remaining / entitlement.total) * 100
            : 0;

        return (
          <article
            key={entitlement.benefitTypeId}
            className="rounded-xl bg-muted/60 p-4 transition-colors duration-150 hover:bg-secondary motion-reduce:transition-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="rounded-full bg-primary/10 p-2 text-primary" aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{entitlement.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entitlement.periodLabel}</p>
                </div>
              </div>
              {entitlement.remaining === null ? (
                <Badge className="shrink-0 bg-success/10 text-success">Unlimited</Badge>
              ) : (
                <p className="shrink-0 text-sm font-bold text-foreground" aria-label={`${entitlement.remaining} of ${entitlement.total} available`}>
                  {entitlement.remaining}<span className="font-normal text-muted-foreground"> / {entitlement.total}</span>
                </p>
              )}
            </div>

            {entitlement.remaining !== null && (
              <Progress
                value={remainingPercent}
                className="mt-4 h-1.5"
                aria-label={`${entitlement.name}: ${entitlement.remaining} of ${entitlement.total} available`}
              />
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {entitlement.giftRemaining > 0 && (
                <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning">
                  <Gift className="h-3 w-3" aria-hidden="true" />
                  Complimentary gift · {entitlement.giftRemaining}
                </Badge>
              )}
              {entitlement.addOnRemaining > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Add-on · {entitlement.addOnRemaining}
                </Badge>
              )}
            </div>

            {entitlement.expiresAt && (entitlement.giftRemaining > 0 || entitlement.addOnRemaining > 0) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Available until {format(new Date(entitlement.expiresAt), 'dd MMM yyyy')}
              </p>
            )}

            {entitlement.isScannerAssessment && entitlement.remaining !== 0 && !frozen && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-background p-3">
                <QrCode className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Scan at club</p>
                  <p className="text-xs text-muted-foreground">Scan the QR shown on the body scanner to begin.</p>
                </div>
              </div>
            )}

            {entitlement.canBookRecovery && entitlement.remaining !== 0 && !frozen && (
              <Button asChild variant="outline" className="mt-4 min-h-11 w-full">
                <Link to="/book?type=recovery">Book {entitlement.name}</Link>
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}