import { Apple, Smartphone, Globe } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { activityLevel, PLATFORM_LABEL } from '@/lib/appUsage/platform';
import type { DeviceInfo } from '@/hooks/useAppDevices';
import { cn } from '@/lib/utils';

export function AppPlatformIcon({ devices, className }: { devices?: DeviceInfo[]; className?: string }) {
  const d = devices?.[0];
  if (!d) return null;
  const level = activityLevel(d.last_seen_at);
  const Icon = d.platform === 'ios' ? Apple : d.platform === 'android' ? Smartphone : Globe;
  const label = `${PLATFORM_LABEL[d.platform]}${d.app_version ? ` · v${d.app_version}` : ''} · ${level === 'online' ? 'online now' : `last opened ${formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true })}`}${devices!.length > 1 ? ` · ${devices!.length} devices` : ''}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} onClick={(e) => e.stopPropagation()}
          className={cn('relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted',
            level === 'inactive' ? 'text-muted-foreground/50' : 'text-foreground', className)}>
          <Icon className="h-3 w-3" aria-hidden />
          {level === 'online' && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-background" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
