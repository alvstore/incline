import { Building2, MapPin } from 'lucide-react';
import { BranchSelector } from '@/components/dashboard/BranchSelector';
import { Badge } from '@/components/ui/badge';
import { useBranchContext } from '@/contexts/BranchContext';

export function MobileBranchBar() {
  const {
    branches,
    currentBranchName,
    selectedBranch,
    setSelectedBranch,
    showAllOption,
    showSelector,
  } = useBranchContext();

  if (showSelector && branches.length > 0) {
    return (
      <div className="border-b border-border bg-card px-4 pb-3 lg:hidden">
        <div className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/60 px-3">
          <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">Branch</span>
          <BranchSelector
            branches={branches}
            selectedBranch={selectedBranch}
            onBranchChange={setSelectedBranch}
            showAllOption={showAllOption}
            triggerClassName="h-11 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            ariaLabel="Select active branch"
            showIcon={false}
          />
        </div>
      </div>
    );
  }

  if (!currentBranchName || currentBranchName === 'All Branches') return null;

  return (
    <div className="border-b border-border bg-card px-4 pb-3 lg:hidden">
      <div className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/60 px-3">
        <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold text-muted-foreground">Branch</span>
        <Badge variant="secondary" className="ml-auto min-w-0 max-w-[70%] justify-start">
          <span className="truncate">{currentBranchName}</span>
        </Badge>
      </div>
    </div>
  );
}