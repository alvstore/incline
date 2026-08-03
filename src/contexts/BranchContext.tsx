import { createContext, useContext, useState, useMemo, useEffect, ReactNode } from 'react';
import { useBranches } from '@/hooks/useBranches';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

type BranchStatus = 'loading' | 'ready' | 'no_branch_assigned' | 'error';

interface BranchContextType {
  selectedBranch: string;
  setSelectedBranch: (id: string) => void;
  effectiveBranchId: string | undefined;
  branchFilter: string | undefined;
  branches: Array<{ id: string; name: string; code: string; [key: string]: any }>;
  isLoading: boolean;
  /** Whether the branch selector should be visible */
  showSelector: boolean;
  /** Whether the "All Branches" option should be available */
  showAllOption: boolean;
  /** Explicit branch status for UI states */
  branchStatus: BranchStatus;
  /** Current branch name for display */
  currentBranchName: string | null;
  /** Retry fetching branch data */
  retryBranchFetch: () => void;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { data: allBranches = [], isLoading: branchesLoading, error: branchesError, refetch: refetchBranches } = useBranches();
  const { user, roles, hasAnyRole, isLoading: authLoading } = useAuth();
  const [selectedBranch, setSelectedBranchState] = useState<string>(() => {
    return localStorage.getItem('incline-selected-branch') || 'all';
  });
  const [initialized, setInitialized] = useState(false);

  const setSelectedBranch = (id: string) => {
    setSelectedBranchState(id);
    localStorage.setItem('incline-selected-branch', id);
    // Mirror the selection on the server (defense-in-depth for RLS / audit).
    // Best-effort: silent on failure so UI remains responsive.
    void supabase
      .rpc('set_active_branch', { p_branch_id: id === 'all' ? null : id })
      .then(({ error }) => {
        if (error) console.warn('[BranchContext] set_active_branch failed', error.message);
      });
  };

  const isOwnerOrAdmin = hasAnyRole(['owner', 'admin']);
  const isManager = hasAnyRole(['manager']);
  const isRestrictedRole = hasAnyRole(['staff', 'trainer', 'member']) && !isOwnerOrAdmin && !isManager;

  // For managers: fetch their assigned branches from staff_branches
  const { data: managerBranches = [], error: managerError, refetch: refetchManager, isPending: managerPending, fetchStatus: managerFetchStatus } = useQuery({
    queryKey: ['manager-branches', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('staff_branches')
        .select('branch_id, branches(id, name, code)')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data || [])
        .map((sb: any) => sb.branches)
        .filter(Boolean);
    },
    enabled: !!user?.id && isManager && !isOwnerOrAdmin,
  });

  // For staff/trainer: fetch their branch from employees/trainers
  const { data: staffBranch, error: staffError, refetch: refetchStaff, isPending: staffPending, fetchStatus: staffFetchStatus } = useQuery({
    queryKey: ['staff-home-branch', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data: emp } = await supabase
        .from('employees')
        .select('branch_id, branches(id, name, code)')
        .eq('user_id', user.id)
        .maybeSingle();
      if (emp?.branches) return emp.branches as any;
      const { data: trainer } = await supabase
        .from('trainers')
        .select('branch_id, branches(id, name, code)')
        .eq('user_id', user.id)
        .maybeSingle();
      if (trainer?.branches) return trainer.branches as any;
      return null;
    },
    enabled: !!user?.id && (hasAnyRole(['staff', 'trainer'])) && !isOwnerOrAdmin && !isManager,
  });

  // For members: fetch their branch
  const { data: memberBranch, error: memberError, refetch: refetchMember, isPending: memberPending, fetchStatus: memberFetchStatus } = useQuery({
    queryKey: ['member-home-branch', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('members')
        .select('branch_id, branches:branch_id(id, name, code)')
        .eq('user_id', user.id)
        .maybeSingle();
      return (data as any)?.branches || null;
    },
    enabled: !!user?.id && hasAnyRole(['member']) && !isOwnerOrAdmin && !isManager && !hasAnyRole(['staff', 'trainer']),
  });

  // Determine the effective branch list based on role
  const branches = useMemo(() => {
    if (isOwnerOrAdmin) return allBranches;
    if (isManager && !isOwnerOrAdmin) return managerBranches;
    if (staffBranch) return [staffBranch];
    if (memberBranch) return [memberBranch];
    return allBranches; // fallback
  }, [isOwnerOrAdmin, isManager, allBranches, managerBranches, staffBranch, memberBranch]);

  const showSelector = useMemo(() => {
    if (isOwnerOrAdmin) return true;
    if (isManager && !isOwnerOrAdmin && managerBranches.length > 1) return true;
    return false;
  }, [isOwnerOrAdmin, isManager, managerBranches]);

  const showAllOption = isOwnerOrAdmin;

  // A role-scoped query is "still resolving" while it is pending AND actually
  // fetching. A disabled query is pending with fetchStatus 'idle' — that must
  // not be treated as loading, otherwise owners would hang forever.
  const managerResolving = managerPending && managerFetchStatus !== 'idle';
  const staffResolving = staffPending && staffFetchStatus !== 'idle';
  const memberResolving = memberPending && memberFetchStatus !== 'idle';

  // Compute branchStatus
  const branchStatus: BranchStatus = useMemo(() => {
    if (!user) return 'loading';
    // Roles arrive asynchronously after a hard refresh. Until they do we cannot
    // tell which branch query matters, so never render "no branch assigned".
    if (authLoading || roles.length === 0) return 'loading';
    if (branchesLoading) return 'loading';

    // Check for errors
    const hasError = branchesError || managerError || staffError || memberError;
    if (hasError && branches.length === 0) return 'error';

    // For restricted roles, check if they have a branch
    if (isRestrictedRole) {
      if (hasAnyRole(['staff', 'trainer'])) {
        if (staffResolving) return 'loading';
        if (!staffBranch) return 'no_branch_assigned';
      }
      if (hasAnyRole(['member'])) {
        if (memberResolving) return 'loading';
        if (!memberBranch) return 'no_branch_assigned';
      }
    }

    if (isManager && !isOwnerOrAdmin) {
      if (managerResolving) return 'loading';
      if (managerBranches.length === 0) return 'no_branch_assigned';
    }

    return 'ready';
  }, [user, authLoading, roles.length, branchesLoading, branchesError, managerError, staffError, memberError, branches, isRestrictedRole, isOwnerOrAdmin, isManager, staffBranch, memberBranch, managerBranches, hasAnyRole, staffResolving, memberResolving, managerResolving]);


  // Auto-initialize branch selection for restricted roles.
  // Honour any previously-saved selection that is still valid for this user.
  useEffect(() => {
    if (initialized) return;
    if (isOwnerOrAdmin) {
      setInitialized(true);
      return;
    }
    const stored = localStorage.getItem('incline-selected-branch');
    const isValid = (id?: string | null) => !!id && branches.some(b => b.id === id);

    if (isManager && !isOwnerOrAdmin && managerBranches.length > 0) {
      if (!isValid(stored)) setSelectedBranch(managerBranches[0].id);
      setInitialized(true);
      return;
    }
    if (staffBranch) {
      // staff/trainer are pinned to their assigned branch — always enforce
      setSelectedBranch(staffBranch.id);
      setInitialized(true);
      return;
    }
    if (memberBranch) {
      setSelectedBranch(memberBranch.id);
      setInitialized(true);
    }
  }, [isOwnerOrAdmin, isManager, managerBranches, staffBranch, memberBranch, branches, initialized]);

  const isLoading = branchesLoading;

  const effectiveBranchId = useMemo(() => {
    if (selectedBranch !== 'all') return selectedBranch;
    return branches[0]?.id;
  }, [selectedBranch, branches]);

  const branchFilter = useMemo(() => {
    return selectedBranch !== 'all' ? selectedBranch : undefined;
  }, [selectedBranch]);

  const currentBranchName = useMemo(() => {
    if (selectedBranch === 'all') return 'All Branches';
    const branch = branches.find(b => b.id === selectedBranch);
    return branch?.name || null;
  }, [selectedBranch, branches]);

  const retryBranchFetch = () => {
    refetchBranches();
    refetchManager();
    refetchStaff();
    refetchMember();
  };

  return (
    <BranchContext.Provider value={{
      selectedBranch,
      setSelectedBranch,
      effectiveBranchId,
      branchFilter,
      branches,
      isLoading,
      showSelector,
      showAllOption,
      branchStatus,
      currentBranchName,
      retryBranchFetch,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranchContext must be used within a BranchProvider');
  }
  return context;
}
