import { useOnlineUsers } from '@/hooks/usePresence';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';

const initials = (name?: string | null) =>
  (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

export function OnlinePresencePill({ compact = false }: { compact?: boolean }) {
  const users = useOnlineUsers();
  const { hasAnyRole } = useAuth();
  const canSeeNames = hasAnyRole(['owner', 'admin', 'manager']);
  const count = users.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${count} users online`}
          className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition hover:bg-success/15 focus:outline-none focus:ring-2 focus:ring-success"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span>{count} online{compact ? '' : ' now'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Active in last 5 min
        </div>
        <div className="max-h-72 overflow-y-auto">
          {count === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No one online</div>
          )}
          {users.map(u => (
            <div key={u.user_id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50">
              <div className="relative">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={u.avatar_url ?? undefined} />
                  <AvatarFallback className="text-xs">{initials(u.full_name)}</AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {canSeeNames ? (u.full_name || 'Unknown user') : 'Team member'}
                </div>
                {canSeeNames && u.roles?.length > 0 && (
                  <div className="truncate text-xs capitalize text-muted-foreground">
                    {u.roles.join(' · ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
