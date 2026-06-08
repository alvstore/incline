import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dumbbell, Droplets, Thermometer, Snowflake,
  Users, Ticket, Apple, Activity, Car, Bath, Scan, PersonStanding, Gift,
} from 'lucide-react';
import { type MemberBenefitBalance, benefitTypeLabels, frequencyLabels } from '@/services/benefitService';
import type { Database } from '@/integrations/supabase/types';

type BenefitType = Database['public']['Enums']['benefit_type'];

const benefitIcons: Record<BenefitType, React.ComponentType<{ className?: string }>> = {
  gym_access: Dumbbell,
  group_classes: Users,
  pt_sessions: Dumbbell,
  pool_access: Droplets,
  sauna_session: Thermometer,
  sauna_access: Thermometer,
  steam_access: Thermometer,
  locker: Bath,
  towel: Bath,
  parking: Car,
  guest_pass: Ticket,
  ice_bath: Snowflake,
  yoga_class: Activity,
  crossfit_class: Activity,
  spa_access: Bath,
  cardio_area: Activity,
  functional_training: Dumbbell,
  body_scan: Scan,
  posture_scan: PersonStanding,
  other: Ticket,
};

interface BenefitBalanceCardProps {
  balance: MemberBenefitBalance;
  showRecordButton?: boolean;
  onRecordUsage?: () => void;
}

export function BenefitBalanceCard({ balance, showRecordButton, onRecordUsage }: BenefitBalanceCardProps) {
  const Icon = benefitIcons[balance.benefit_type] || Dumbbell;

  const planLimit = balance.limit_count || 0;
  const planUsed = balance.used || 0;
  const planRemaining = balance.isUnlimited ? null : Math.max(0, planLimit - planUsed);

  const compTotal = balance.compTotal || 0;
  const compUsed = balance.compUsed || 0;
  const compRemaining = Math.max(0, balance.compRemaining ?? (compTotal - compUsed));
  const hasComp = compTotal > 0;

  const totalLimit = planLimit + compTotal;
  const totalUsed = planUsed + compUsed;
  const totalRemaining = balance.isUnlimited ? null : Math.max(0, totalLimit - totalUsed);

  const progressValue = balance.isUnlimited
    ? 100
    : totalLimit
      ? (totalUsed / totalLimit) * 100
      : 0;

  const isExhausted = !balance.isUnlimited && totalRemaining === 0;
  const isGiftOnly = !!balance.isGiftOnly;

  return (
    <Card className={`rounded-xl shadow-sm transition-all hover:shadow-md ${isExhausted ? 'opacity-70' : ''} ${isGiftOnly ? 'border-warning/40 bg-warning/10' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-5 w-5 ${isGiftOnly ? 'text-warning' : 'text-primary'}`} />
            <CardTitle className="text-base truncate">
              {balance.label || benefitTypeLabels[balance.benefit_type]}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasComp && !isGiftOnly && (
              <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px] gap-1 hover:bg-warning/20">
                <Gift className="h-3 w-3" /> +{compRemaining}
              </Badge>
            )}
            {isGiftOnly && (
              <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px] gap-1">
                <Gift className="h-3 w-3" /> Complimentary
              </Badge>
            )}
            <Badge variant={balance.isUnlimited ? 'default' : 'outline'} className="text-[10px]">
              {frequencyLabels[balance.frequency]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {balance.isUnlimited ? (
          <div className="text-sm text-muted-foreground">
            Unlimited access{hasComp && <span className="ml-1 text-warning font-medium">+ {compRemaining} gift</span>}
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Available</div>
                <div className={`text-2xl font-bold ${isExhausted ? 'text-destructive' : 'text-foreground'}`}>
                  {totalRemaining}
                  <span className="text-sm text-muted-foreground font-normal ml-1">/ {totalLimit}</span>
                </div>
              </div>
              {hasComp && (
                <div className="text-right text-xs text-muted-foreground leading-tight">
                  <div>{planRemaining ?? 0} plan</div>
                  <div className="text-warning font-medium">+ {compRemaining} gift</div>
                </div>
              )}
            </div>
            <Progress
              value={progressValue}
              className={progressValue >= 100 ? '[&>div]:bg-destructive' : ''}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{totalUsed} used</span>
              <span>{totalRemaining === 0 ? 'Exhausted' : `${totalRemaining} remaining`}</span>
            </div>
          </>
        )}

        {balance.description && (
          <p className="text-xs text-muted-foreground">{balance.description}</p>
        )}

        {showRecordButton && !isExhausted && (
          <button
            onClick={onRecordUsage}
            className="w-full mt-2 text-sm bg-primary text-primary-foreground rounded-md py-2 hover:bg-primary/90 transition-colors"
          >
            Record Usage
          </button>
        )}
      </CardContent>
    </Card>
  );
}

interface BenefitBalancesGridProps {
  balances: MemberBenefitBalance[];
  showRecordButtons?: boolean;
  onRecordUsage?: (benefitType: BenefitType, benefitTypeId?: string | null) => void;
}

export function BenefitBalancesGrid({ balances, showRecordButtons, onRecordUsage }: BenefitBalancesGridProps) {
  if (balances.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No benefits available with current plan
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {balances.map((balance, idx) => (
        <BenefitBalanceCard
          key={`${balance.benefit_type}-${balance.benefit_type_id || idx}`}
          balance={balance}
          showRecordButton={showRecordButtons}
          onRecordUsage={() => onRecordUsage?.(balance.benefit_type, balance.benefit_type_id)}
        />
      ))}
    </div>
  );
}
