import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dumbbell, Star, Users, Zap, Info } from 'lucide-react';
import { invalidateMembersData } from '@/lib/memberInvalidation';

interface AssignTrainerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  memberName: string;
  branchId: string;
  currentTrainerId?: string;
  /** Read-only context: the trainer coaching this member's PT package, if any. */
  ptTrainerName?: string;
}

export function AssignTrainerDrawer({
  open,
  onOpenChange,
  memberId,
  memberName,
  branchId,
  currentTrainerId,
  ptTrainerName,
}: AssignTrainerDrawerProps) {
  const queryClient = useQueryClient();
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>(currentTrainerId || '');

  // Keep the selection in sync — the current trainer id may arrive after the drawer opens.
  useEffect(() => {
    if (open) {
      setSelectedTrainerId(currentTrainerId || '');
    }
  }, [open, currentTrainerId]);

  // Fetch trainers with utilization
  const { data: trainers = [], isLoading } = useQuery({
    queryKey: ['trainers-utilization', branchId, currentTrainerId ?? 'none'],
    queryFn: async () => {
      const { data: trainerList, error } = await supabase
        .from('trainers')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true);

      if (error) throw error;

      const trainersWithUtilization = await Promise.all(
        (trainerList || []).map(async (trainer: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', trainer.user_id)
            .single();

          const { count: assignedMembers } = await supabase
            .from('members')
            .select('id', { count: 'exact', head: true })
            .eq('assigned_trainer_id', trainer.id)
            .eq('status', 'active');

          const { count: ptClients } = await supabase
            .from('member_pt_packages')
            .select('id', { count: 'exact', head: true })
            .eq('trainer_id', trainer.id)
            .eq('status', 'active');

          const totalClients = (assignedMembers || 0) + (ptClients || 0);
          const maxClients = trainer.max_clients || 20;
          const utilization = Math.min(100, Math.round((totalClients / maxClients) * 100));

          return { ...trainer, profile, totalClients, maxClients, utilization };
        })
      );

      return trainersWithUtilization.sort((a, b) => {
        if (a.id === currentTrainerId) return -1;
        if (b.id === currentTrainerId) return 1;
        return a.utilization - b.utilization;
      });
    },
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const trainerId = selectedTrainerId === 'none' || !selectedTrainerId ? null : selectedTrainerId;
      const { error } = await supabase
        .from('members')
        .update({ assigned_trainer_id: trainerId })
        .eq('id', memberId);
      if (error) throw error;
    },
    onMutate: async () => {
      // Optimistic update: update members cache immediately
      await queryClient.cancelQueries({ queryKey: ['members'] });
      const previousMembers = queryClient.getQueryData(['members']);

      queryClient.setQueriesData({ queryKey: ['members'] }, (old: any) => {
        if (!old) return old;
        // Handle paginated result shape
        if (old?.data && Array.isArray(old.data)) {
          return {
            ...old,
            data: old.data.map((m: any) =>
              m.id === memberId
                ? { ...m, assigned_trainer_id: selectedTrainerId === 'none' ? null : selectedTrainerId }
                : m
            ),
          };
        }
        if (Array.isArray(old)) {
          return old.map((m: any) =>
            m.id === memberId
              ? { ...m, assigned_trainer_id: selectedTrainerId === 'none' ? null : selectedTrainerId }
              : m
          );
        }
        return old;
      });

      return { previousMembers };
    },
    onSuccess: () => {
      toast.success(selectedTrainerId ? 'Trainer assigned successfully' : 'Trainer removed');
      invalidateMembersData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['trainers-utilization'] });
      onOpenChange(false);
    },
    onError: (error: any, _, context: any) => {
      // Rollback on error
      if (context?.previousMembers) {
        queryClient.setQueryData(['members'], context.previousMembers);
      }
      toast.error(error.message || 'Failed to assign trainer');
    },
  });

  const getUtilizationColor = (utilization: number) => {
    if (utilization >= 90) return 'bg-destructive';
    if (utilization >= 70) return 'bg-warning';
    return 'bg-success';
  };

  const recommendedTrainer = trainers[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5" />
            Assign General Trainer
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Member Info */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <p className="font-medium">{memberName}</p>
              <p className="text-sm text-muted-foreground">General Training Assignment</p>
              {ptTrainerName && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">Personal trainer for PT sessions: </span>
                  <span className="font-medium">{ptTrainerName}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Info Card — General vs PT */}
          <Card className="border-info/30 bg-info/5">
            <CardContent className="pt-4 flex items-start gap-3">
              <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">General vs Personal Training</p>
                <p>A <strong>General Trainer</strong> guides the member's overall gym experience — form checks, basic routines, and general support.</p>
                <p className="mt-1">For dedicated <strong>Personal Training sessions</strong>, the member needs to purchase a PT package separately. PT sessions are tracked with commissions.</p>
              </div>
            </CardContent>
          </Card>

          {/* Auto-Recommendation */}
          {recommendedTrainer && !currentTrainerId && (
            <Card className="border-success/50 bg-success/5">
              <CardContent className="pt-4 flex items-center gap-3">
                <Zap className="h-5 w-5 text-success" />
                <div className="flex-1">
                  <p className="font-medium text-success">Recommended</p>
                  <p className="text-sm text-muted-foreground">
                    {recommendedTrainer.profile?.full_name} has the most availability
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setSelectedTrainerId(recommendedTrainer.id)}>
                  Select
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Trainer List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <RadioGroup value={selectedTrainerId} onValueChange={setSelectedTrainerId}>
              <div className="space-y-3">
                <Card className={`cursor-pointer transition-colors ${selectedTrainerId === 'none' || !selectedTrainerId ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="none" id="no-trainer" />
                      <Label htmlFor="no-trainer" className="flex-1 cursor-pointer">
                        <span className="font-medium">No Trainer Assigned</span>
                        <p className="text-sm text-muted-foreground">Member will not have a dedicated trainer</p>
                      </Label>
                    </div>
                  </CardContent>
                </Card>

                {trainers.map((trainer: any) => (
                  <Card
                    key={trainer.id}
                    className={`cursor-pointer transition-colors ${
                      selectedTrainerId === trainer.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    } ${trainer.utilization >= 100 ? 'opacity-50' : ''}`}
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value={trainer.id} id={trainer.id} disabled={trainer.utilization >= 100} />
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={trainer.profile?.avatar_url} />
                          <AvatarFallback>{trainer.profile?.full_name?.charAt(0) || 'T'}</AvatarFallback>
                        </Avatar>
                        <Label htmlFor={trainer.id} className="flex-1 cursor-pointer">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{trainer.profile?.full_name}</span>
                            {trainer.id === currentTrainerId && (
                              <Badge variant="outline" className="text-xs">Current</Badge>
                            )}
                          </div>
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {trainer.totalClients}/{trainer.maxClients} clients
                              </span>
                              <span className={trainer.utilization >= 90 ? 'text-destructive' : ''}>
                                {trainer.utilization}% busy
                              </span>
                            </div>
                            <Progress value={trainer.utilization} className={`h-1.5 ${getUtilizationColor(trainer.utilization)}`} />
                          </div>
                          {trainer.utilization >= 100 && (
                            <p className="text-xs text-destructive mt-1">At capacity</p>
                          )}
                        </Label>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </RadioGroup>
          )}
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => assignMutation.mutate()} disabled={assignMutation.isPending}>
            {assignMutation.isPending ? 'Assigning...' : 'Assign Trainer'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
