import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Pencil, FileText, MoreHorizontal, UserMinus, UserCheck, ChevronDown,
  Briefcase, Dumbbell, User,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UNIFIED_STAFF_KEY, type UnifiedStaffPerson, type StaffRole } from '@/hooks/useUnifiedStaff';

interface Props {
  person: UnifiedStaffPerson;
  onEdit: (person: UnifiedStaffPerson, role: StaffRole) => void;
  onContract: (person: UnifiedStaffPerson, role: StaffRole) => void;
}

const roleIcon = (r: StaffRole) =>
  r === 'trainer' ? <Dumbbell className="h-3.5 w-3.5 mr-2" />
    : r === 'manager' ? <Briefcase className="h-3.5 w-3.5 mr-2" />
    : <User className="h-3.5 w-3.5 mr-2" />;

const roleLabel = (r: StaffRole) => r.charAt(0).toUpperCase() + r.slice(1);

export function StaffRowActions({ person, onEdit, onContract }: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const toggleActive = async () => {
    try {
      const next = !person.is_active;
      const tasks: Promise<any>[] = [];
      if (person.employee) {
        tasks.push(
          supabase.from('employees').update({ is_active: next }).eq('id', person.employee.id),
        );
      }
      if (person.trainer) {
        tasks.push(
          supabase.from('trainers').update({ is_active: next }).eq('id', person.trainer.id),
        );
      }
      const results = await Promise.all(tasks);
      const err = results.find((r: any) => r?.error)?.error;
      if (err) throw err;
      toast.success(next ? 'Activated' : 'Deactivated');
      queryClient.invalidateQueries({ queryKey: UNIFIED_STAFF_KEY });
      queryClient.invalidateQueries({ queryKey: ['hrm-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hrm-payroll-staff'] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    } finally {
      setConfirmOpen(false);
    }
  };

  const primaryRole = person.roles[0];
  const multi = person.roles.length > 1;

  return (
    <div className="flex items-center justify-end gap-1">
      {/* Primary: Edit */}
      {multi ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs">Edit which role?</DropdownMenuLabel>
            {person.roles.map((r) => (
              <DropdownMenuItem key={r} onClick={() => onEdit(person, r)}>
                {roleIcon(r)} {roleLabel(r)} profile
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button size="sm" variant="outline" className="h-8" onClick={() => onEdit(person, primaryRole)}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      )}

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">Contracts</DropdownMenuLabel>
          {(multi ? person.roles : [primaryRole]).map((r) => (
            <DropdownMenuItem key={r} onClick={() => onContract(person, r)}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              New contract — {roleLabel(r)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className={person.is_active ? 'text-destructive focus:text-destructive' : ''}
          >
            {person.is_active
              ? <><UserMinus className="h-3.5 w-3.5 mr-2" /> Deactivate</>
              : <><UserCheck className="h-3.5 w-3.5 mr-2" /> Reactivate</>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {person.is_active ? 'Deactivate' : 'Reactivate'} {person.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {person.is_active
                ? `Removes ${person.name} from active rosters, payroll runs and attendance for all ${person.roles.length > 1 ? 'roles' : 'their role'}. Their history stays intact and you can reactivate anytime.`
                : `${person.name} will be restored to active status and appear in rosters, payroll and attendance again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={toggleActive}
              className={person.is_active ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {person.is_active ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
