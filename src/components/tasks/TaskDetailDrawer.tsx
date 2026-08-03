import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Calendar, Clock, ExternalLink, History, MessageSquare, Bell, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchTaskHistory,
  fetchTaskComments,
  addTaskComment,
  fetchTaskReminders,
  scheduleTaskReminder,
  deleteTask,
} from '@/services/taskService';
import { useAuth } from '@/contexts/AuthContext';
import { can } from '@/lib/auth/permissions';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface TaskDetailDrawerProps {
  task: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Routes that actually exist in the app. The members screen is a list that
// opens the profile drawer via ?member=<id> — there is no /members/:id route.
const linkedEntityRoute: Record<string, (id: string) => string> = {
  member: (id) => `/members?member=${id}`,
  invoice: (id) => `/invoices?id=${id}`,
  approval: (_id) => `/approvals`,
  lead: (id) => `/leads?id=${id}`,
  booking: (_id) => `/all-bookings`,
  complaint: (_id) => `/feedback`,
};

const LINKED_ENTITY_LABEL: Record<string, string> = {
  member: 'member',
  invoice: 'invoice',
  approval: 'approval',
  lead: 'lead',
  booking: 'booking',
  complaint: 'feedback',
};

export function TaskDetailDrawer({ task, open, onOpenChange }: TaskDetailDrawerProps) {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const [comment, setComment] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const roleNames = (roles || []).map((r: any) => r.role);
  const canDelete = can.deleteTask(roleNames);

  const { data: history = [] } = useQuery({
    queryKey: ['task-history', task?.id],
    queryFn: () => fetchTaskHistory(task!.id),
    enabled: !!task?.id && open,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['task-comments', task?.id],
    queryFn: () => fetchTaskComments(task!.id),
    enabled: !!task?.id && open,
  });

  const { data: reminders = [] } = useQuery({
    queryKey: ['task-reminders', task?.id],
    queryFn: () => fetchTaskReminders(task!.id),
    enabled: !!task?.id && open,
  });

  const commentMutation = useMutation({
    mutationFn: () => addTaskComment(task!.id, comment.trim(), user!.id),
    onSuccess: () => {
      setComment('');
      toast.success('Comment added');
      qc.invalidateQueries({ queryKey: ['task-comments', task?.id] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to add comment'),
  });

  const reminderMutation = useMutation({
    mutationFn: () => scheduleTaskReminder(task!.id, new Date(remindAt).toISOString()),
    onSuccess: () => {
      setRemindAt('');
      toast.success('Reminder scheduled');
      qc.invalidateQueries({ queryKey: ['task-reminders', task?.id] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to schedule'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task!.id),
    onSuccess: () => {
      toast.success('Task deleted');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task-stats'] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to delete task'),
  });

  if (!task) return null;

  const linkRoute =
    task.linked_entity_type && task.linked_entity_id && linkedEntityRoute[task.linked_entity_type]
      ? linkedEntityRoute[task.linked_entity_type](task.linked_entity_id)
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="flex flex-row items-start justify-between gap-2">
          <SheetTitle className="text-left">{task.title}</SheetTitle>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Delete task" className="text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes "{task.title}" and its comments, history, and reminders. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Delete task
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{task.status?.replace('_', ' ')}</Badge>
            <Badge variant="outline">{task.priority}</Badge>
            {task.due_date && (
              <Badge variant="outline" className="gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(task.due_date).toLocaleDateString()}
              </Badge>
            )}
          </div>

          {task.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
          )}

          {linkRoute && (
            <a
              href={linkRoute}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open linked {task.linked_entity_type}
            </a>
          )}

          <Tabs defaultValue="comments" className="mt-4">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="comments" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                Comments
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1">
                <History className="h-3 w-3" />
                History
              </TabsTrigger>
              <TabsTrigger value="reminders" className="gap-1">
                <Bell className="h-3 w-3" />
                Reminders
              </TabsTrigger>
            </TabsList>

            <TabsContent value="comments" className="space-y-3">
              <div className="space-y-2 max-h-72 overflow-y-auto rounded-md border p-2 bg-muted/30">
                {comments.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No comments yet</p>
                )}
                {comments.map((c) => (
                  <div key={c.id} className="rounded-md bg-background p-2 shadow-sm">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="font-medium">{c.author?.full_name || c.author?.email || 'User'}</span>
                      <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
              <Textarea
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
              <Button
                size="sm"
                disabled={!comment.trim() || commentMutation.isPending}
                onClick={() => commentMutation.mutate()}
              >
                Post comment
              </Button>
            </TabsContent>

            <TabsContent value="history" className="space-y-2">
              {history.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">No status changes yet</p>
              )}
              {history.map((h) => (
                <div key={h.id} className="flex gap-2 rounded-md border p-2 bg-background">
                  <Clock className="h-3 w-3 mt-1 text-muted-foreground" />
                  <div className="text-sm">
                    <div>
                      <span className="text-muted-foreground">{h.from_status || '—'}</span>
                      {' → '}
                      <span className="font-medium">{h.to_status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {h.changer?.full_name || h.changer?.email || 'System'} ·{' '}
                      {formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}
                    </div>
                    {h.note && <div className="text-xs mt-1">{h.note}</div>}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="reminders" className="space-y-3">
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {reminders.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No reminders scheduled</p>
                )}
                {reminders.map((r) => (
                  <div key={r.id} className="flex justify-between rounded-md border p-2 bg-background text-sm">
                    <div>
                      <div className="font-medium">{new Date(r.remind_at).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.channel} · {r.sent_at ? `sent ${formatDistanceToNow(new Date(r.sent_at), { addSuffix: true })}` : 'pending'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!remindAt || reminderMutation.isPending}
                  onClick={() => reminderMutation.mutate()}
                >
                  Schedule
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
