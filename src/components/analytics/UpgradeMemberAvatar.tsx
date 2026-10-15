import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function UpgradeMemberAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <Avatar className={cn('h-9 w-9', className)} aria-hidden="true">
    <AvatarImage src={src ?? undefined} alt="" className="object-cover" />
    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials || 'M'}</AvatarFallback>
  </Avatar>;
}