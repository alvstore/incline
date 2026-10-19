import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { GymLoader } from '@/components/ui/gym-loader';
import { AuthVisualPanel } from '@/components/auth/AuthVisualPanel';
import { getHomePath } from '@/lib/roleRedirect';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function SetPasswordPage() {
  const { user, isLoading, mustSetPassword, roles } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <GymLoader text="Warming up..." />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!mustSetPassword) return <Navigate to={getHomePath(roles)} replace />;

  return (
    <div className="min-h-dvh w-full bg-background lg:grid lg:grid-cols-2">
      {/* LEFT — brand visual */}
      <div className="relative isolate h-24 overflow-hidden lg:h-auto lg:min-h-dvh">
        <AuthVisualPanel />
      </div>

      {/* RIGHT — form */}
      <div className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
        <div className="relative w-full flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="min-h-11 cursor-pointer text-muted-foreground hover:text-foreground transition-colors duration-200 focus-visible:ring-ring"
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>


        <div className="relative w-full flex justify-center">
          <SetPasswordForm />
        </div>
      </div>
    </div>
  );
}
