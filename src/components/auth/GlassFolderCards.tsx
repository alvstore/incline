import { ArrowUpRight, Activity, Snowflake } from 'lucide-react';
import riseImg from '@/assets/auth-rise.jpg';
import reflectImg from '@/assets/auth-reflect.jpg';
import repeatImg from '@/assets/auth-repeat.jpg';

const PILLARS = [
  { name: 'Rise', summary: 'Panatta strength, PT and group classes.', icon: ArrowUpRight, img: riseImg },
  { name: 'Reflect', summary: 'Infrared sauna, cold plunge and steam.', icon: Snowflake, img: reflectImg },
  { name: 'Repeat', summary: '3D body scans that track your progress.', icon: Activity, img: repeatImg },
];

/** Three photo pillars — always visible, always dark-scrimmed so text never washes out. */
export function GlassFolderCards() {
  return (
    <ul className="mt-8 grid grid-cols-3 gap-3" aria-label="The Incline experience">
      {PILLARS.map(({ name, summary, icon: Icon, img }, i) => (
        <li key={name} className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-sidebar-border bg-sidebar-accent">
          <img src={img} alt="" width={768} height={1024} loading={i === 0 ? 'eager' : 'lazy'}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/50 to-transparent" aria-hidden="true" />
          <div className="relative flex h-full flex-col justify-between p-4 text-sidebar-foreground">
            <span className="flex items-center justify-between text-xs font-medium text-sidebar-foreground/80">
              0{i + 1}
              <span className="rounded-full bg-sidebar-primary p-1.5 text-sidebar-primary-foreground"><Icon className="h-3.5 w-3.5" /></span>
            </span>
            <span>
              <span className="block text-lg font-semibold">{name}.</span>
              <span className="mt-1 block text-xs leading-snug text-sidebar-foreground/85">{summary}</span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
