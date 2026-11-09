import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { DisasterRecoveryCard } from '@/components/system/DisasterRecoveryCard';
import { StandbyServerCard } from '@/components/system/StandbyServerCard';

/**
 * Disaster Recovery settings. The old JSON export/restore was removed: it skipped sign-in
 * accounts, files and database structure, so it could never restore the app.
 */
export function BackupRestore() {
  const { roles } = useAuth();
  if (!can.manageStandbyCopy(roles)) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>Disaster Recovery is available to the owner only.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-6">
      <StandbyServerCard />
      <DisasterRecoveryCard />
    </div>
  );
}
