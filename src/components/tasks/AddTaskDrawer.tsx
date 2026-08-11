import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTask, type TaskPriority } from '@/services/taskService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface AddTaskDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddTaskDrawer({ open, onOpenChange }: AddTaskDrawerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch only staff/trainers/managers (not members)
  const { data: users = [] } = useQuery({
    queryKey: ['assignable-staff-users'],
    queryFn: async () => {
      // Get user IDs with staff roles (trainer, staff, manager, admin, owner)
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['trainer', 'staff', 'manager', 'admin', 'owner']);
      
      const staffUserIds = (roleData || []).map(r => r.user_id);
      
      if (staffUserIds.length === 0) {
        return [];
      }
      
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', staffUserIds);
      
      return data || [];
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await supabase.from('branches').select('id, name');
      return data || [];
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      toast.success('Task created successfully');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-stats'] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to create task: ' + error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    createTaskMutation.mutate({
      branchId: formData.get('branchId') as string,
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      priority: formData.get('priority') as TaskPriority,
      dueDate: formData.get('dueDate') as string || undefined,
      dueTime: formData.get('dueTime') as string || undefined,
      slaHours: formData.get('slaHours') ? parseInt(formData.get('slaHours') as string) : 24,
      memberCreated: formData.get('memberCreated') === 'on',
      assignedTo: formData.get('assignedTo') as string || undefined,
      assignedBy: user?.id,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create New Task</SheetTitle>
          <SheetDescription>Add a new task and assign it to team members</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="branchId">Branch *</Label>
            <Select name="branchId" required>
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch: any) => (
                  <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input name="title" placeholder="Task title" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea name="description" placeholder="Task description..." rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select name="priority" defaultValue="medium">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date</Label>
              <div className="flex gap-2">
                <Input type="date" name="dueDate" className="flex-1" />
                <Input type="time" name="dueTime" className="w-32" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="slaHours">SLA (Hours)</Label>
              <Input type="number" name="slaHours" defaultValue={24} min={1} />
            </div>
            <div className="space-y-2 flex items-center gap-2 pt-8">
              <input type="checkbox" name="memberCreated" id="memberCreated" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
              <Label htmlFor="memberCreated" className="cursor-pointer">Member Request</Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignedTo">Assign To</Label>
            <Select name="assignedTo">
              <SelectTrigger>
                <SelectValue placeholder="Select user (optional)" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createTaskMutation.isPending}>
              {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
