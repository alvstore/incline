import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Eye, Pencil } from 'lucide-react';
import type { ConversationPresence } from '@/hooks/useConversationPresence';

function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

interface Props {
  viewing: ConversationPresence[];
  typing: ConversationPresence[];
}

/**
 * Compact bar showing which other agents are currently viewing or typing
 * in this WhatsApp conversation. Hidden when no other agents present.
 */
export function AgentPresenceBar({ viewing, typing }: Props) {
  if (viewing.length === 0 && typing.length === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-900">
      {typing.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Pencil className="h-3.5 w-3.5 text-amber-600" />
          <div className="flex -space-x-1.5">
            {typing.slice(0, 3).map((p) => (
              <Avatar key={p.user_id} className="h-5 w-5 border border-amber-200">
                <AvatarImage src={p.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px] bg-amber-200 text-amber-900">
                  {initials(p.full_name)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span className="font-medium">
            {typing.map((p) => p.full_name || 'Agent').join(', ')} typing…
          </span>
        </div>
      )}
      {viewing.length > 0 && (
        <div className="flex items-center gap-1.5 text-amber-700">
          <Eye className="h-3.5 w-3.5" />
          <div className="flex -space-x-1.5">
            {viewing.slice(0, 3).map((p) => (
              <Avatar key={p.user_id} className="h-5 w-5 border border-amber-200">
                <AvatarImage src={p.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px] bg-white text-amber-700">
                  {initials(p.full_name)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
          <span>
            {viewing.length === 1
              ? `${viewing[0].full_name || 'Another agent'} is viewing`
              : `${viewing.length} agents viewing`}
          </span>
        </div>
      )}
    </div>
  );
}
