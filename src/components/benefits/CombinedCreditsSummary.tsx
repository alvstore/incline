import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Gift, Plus, Sparkles } from 'lucide-react';
import { differenceInDays, format } from 'date-fns';

export interface CreditRow {
  id: string;
  benefit_type: any;
  package_id: string | null;
  credits_total: number;
  credits_remaining: number;
  expires_at: string;
}

interface Props {
  credits: CreditRow[];
  onBuyAddon?: () => void;
  disabled?: boolean;
}

const labelOf = (bt: any): string => {
  if (!bt) return 'Benefit';
  if (typeof bt === 'string') return bt;
  return bt.name || bt.code || 'Benefit';
};

/**
 * Unified summary across plan-included credits (package_id IS NULL) and
 * purchased add-on credits (package_id IS NOT NULL).
 *
 * Shows total remaining vs total granted, earliest expiry, low-balance
 * warning, and a single "Buy Add-On" CTA.
 */
export function CombinedCreditsSummary({ credits, onBuyAddon, disabled }: Props) {
  if (credits.length === 0) return null;

  const totalRemaining = credits.reduce((s, c) => s + (c.credits_remaining || 0), 0);
  const totalGranted = credits.reduce((s, c) => s + (c.credits_total || 0), 0);
  const usedPct = totalGranted > 0 ? ((totalGranted - totalRemaining) / totalGranted) * 100 : 0;

  const earliestExpiry = credits
    .map((c) => new Date(c.expires_at).getTime())
    .sort((a, b) => a - b)[0];
  const daysToExpiry = differenceInDays(new Date(earliestExpiry), new Date());

  const planCount = credits.filter((c) => !c.package_id).length;
  const addOnCount = credits.filter((c) => !!c.package_id).length;

  const lowBalance = totalGranted > 0 && totalRemaining / totalGranted <= 0.2;
  const expiringSoon = daysToExpiry <= 7;

  // Group by benefit label for compact breakdown
  const grouped = credits.reduce<Record<string, { remaining: number; total: number }>>((acc, c) => {
    const key = labelOf(c.benefit_type);
    if (!acc[key]) acc[key] = { remaining: 0, total: 0 };
    acc[key].remaining += c.credits_remaining || 0;
    acc[key].total += c.credits_total || 0;
    return acc;
  }, {});

  return (
    <Card className="rounded-2xl border-border/50 bg-gradient-to-br from-primary/5 via-background to-accent/5 shadow-lg shadow/40">
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Available Credits</h3>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Across plan and purchased add-ons
            </p>
          </div>
          {onBuyAddon && (
            <Button onClick={onBuyAddon} disabled={disabled} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Buy Add-On
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-2xl font-bold">{totalRemaining}</div>
            <div className="text-xs text-muted-foreground">Remaining</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-muted-foreground">{totalGranted}</div>
            <div className="text-xs text-muted-foreground">Granted</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{credits.length}</div>
            <div className="text-xs text-muted-foreground">Credit pools</div>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Used {Math.round(usedPct)}%</span>
            <span>
              <Badge variant="outline" className="text-[10px] mr-1">{planCount} plan</Badge>
              <Badge variant="outline" className="text-[10px]">{addOnCount} add-on</Badge>
            </span>
          </div>
          <Progress value={usedPct} className="h-2" />
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(grouped).map(([label, v]) => (
            <Badge key={label} variant="secondary" className="text-xs">
              <Gift className="h-3 w-3 mr-1" />
              {label}: {v.remaining}/{v.total}
            </Badge>
          ))}
        </div>

        {(lowBalance || expiringSoon) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 dark:bg-warning/20 border border-warning/25 dark:border-warning/40">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs text-warning dark:text-warning">
              {lowBalance && <div><strong>Low balance:</strong> only {totalRemaining} of {totalGranted} credits left.</div>}
              {expiringSoon && (
                <div>
                  <strong>Expiring soon:</strong> earliest pool expires {format(new Date(earliestExpiry), 'dd MMM yyyy')}
                  {daysToExpiry >= 0 ? ` (in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'})` : ''}
                </div>
              )}
              {onBuyAddon && (
                <Button
                  variant="link"
                  className="h-auto p-0 text-warning dark:text-warning text-xs mt-1"
                  onClick={onBuyAddon}
                  disabled={disabled}
                >
                  Top up now →
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
