import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface Props {
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md';
  className?: string;
  showName?: boolean;
}

const PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-fuchsia-100 text-fuchsia-700',
];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function initialsOf(name?: string | null, email?: string | null) {
  const s = (name || email || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function AssigneeAvatar({ name, email, size = 'sm', className, showName }: Props) {
  if (!name && !email) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-slate-400', className)}>
        <span
          className={cn(
            'rounded-full ring-2 ring-white bg-slate-100 text-slate-400 flex items-center justify-center font-medium',
            size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs',
          )}
        >
          ?
        </span>
        {showName && 'Unassigned'}
      </span>
    );
  }
  const label = name || email || '?';
  const initials = initialsOf(name, email);
  const tone = colorFor(label);

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Avatar className={cn(size === 'sm' ? 'h-6 w-6' : 'h-8 w-8', 'ring-2 ring-white')}>
        <AvatarFallback className={cn('font-semibold', tone, size === 'sm' ? 'text-[10px]' : 'text-xs')}>
          {initials}
        </AvatarFallback>
      </Avatar>
      {showName && <span className="text-xs font-medium text-slate-700 truncate max-w-[110px]">{label}</span>}
    </span>
  );
}
